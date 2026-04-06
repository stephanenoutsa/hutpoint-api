import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { toNullableJson } from "../lib/json.js";
import {
  buildScaledTiers, buildB2BTiers, getMerchantTierDef,
  PLATFORM_DEFAULTS, MERCHANT_TIERS, CURRENCIES,
} from "../lib/tiers.js";

const app = new Hono();

// ─── Register business ────────────────────────────────────────────────────────

app.post(
  "/",
  zValidator("json", z.object({
    businessName: z.string().min(1),
    industry:     z.string().min(1),
    currency:     z.string().default("FCFA"),
    currencySymbol: z.string().default("FCFA"),
    merchantTierKey: z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const TEST_PTS = 2000;

    const business = await db.business.create({
      data: {
        ...data,
        merchantTierKey: data.merchantTierKey ?? "micro",
        wallet: {
          create: { points: TEST_PTS, totalPurchased: TEST_PTS, testPoints: true },
        },
      },
      include: { wallet: true },
    });

    return c.json({ ok: true, business }, 201);
  },
);

// ─── List businesses ──────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const businesses = await db.business.findMany({
    include: { wallet: true },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, businesses });
});

// ─── Get single business ──────────────────────────────────────────────────────

app.get("/:id", async (c) => {
  const business = await db.business.findUnique({
    where: { id: c.req.param("id") },
    include: { wallet: true, coalition: true },
  });
  if (!business) return errorResponse(c, 404, "Business not found");
  return c.json({ ok: true, business });
});

// ─── Update business settings ─────────────────────────────────────────────────

app.patch(
  "/:id/settings",
  zValidator("json", z.object({
    spendThreshold:    z.number().optional(),
    comebackWindowDays: z.number().int().optional(),
    bizReturnRate:     z.number().optional(),
    creditFromBronze:  z.boolean().optional(),
    surpriseMode:      z.boolean().optional(),
    newCustomerBonus:  z.number().int().optional(),
    vipMultipliers:    z.array(z.number()).length(4).nullable().optional(),
  })),
  async (c) => {
    const id = c.req.param("id");
    const { vipMultipliers, ...rest } = c.req.valid("json");
    const data = { ...rest, ...(vipMultipliers !== undefined ? { vipMultipliers: toNullableJson(vipMultipliers) } : {}) };
    const business = await db.business.update({ where: { id }, data });
    return c.json({ ok: true, business });
  },
);

// ─── Purchase points (top-up) ─────────────────────────────────────────────────

app.post(
  "/:id/wallet/topup",
  zValidator("json", z.object({ pts: z.number().int().positive() })),
  async (c) => {
    const businessId = c.req.param("id");
    const { pts } = c.req.valid("json");

    const business = await db.business.findUnique({
      where: { id: businessId },
      include: { wallet: true },
    });
    if (!business) return errorResponse(c, 404, "Business not found");

    const curDef = CURRENCIES.find((x) => x.code === business.currency) ?? CURRENCIES[0];
    const tierDef = getMerchantTierDef(business.merchantTierKey);
    const rate = curDef.redemptionRate;
    const ptPrice = (rate / (1 - tierDef.margin)) *
      (business.coalitionId && !business.coalitionSuspended ? 0.8 : 1);
    const cost = pts * ptPrice;

    // Settle any blocked transactions that can now be fulfilled
    const blockedTxs = await db.transaction.findMany({
      where: { businessId, pointsBlocked: true, pointsOwed: { gt: 0 } },
      orderBy: { createdAt: "asc" },
    });

    const currentPts = (business.wallet?.points ?? 0) + pts;
    let running = currentPts;
    const toSettle: string[] = [];

    for (const tx of blockedTxs) {
      if (running >= tx.pointsOwed) {
        toSettle.push(tx.id);
        running -= tx.pointsOwed;
      }
    }

    await db.$transaction(async (tx) => {
      // Top up wallet
      await tx.bizWallet.update({
        where: { businessId },
        data: { points: { increment: pts }, totalPurchased: { increment: pts } },
      });

      // Record revenue ledger entry
      await tx.ledgerEntry.create({
        data: {
          type: "revenue", businessId, pts, amount: cost,
          currency: business.currency, sym: business.currencySymbol,
          description: `${business.businessName} purchased ${pts.toLocaleString()} pts`,
        },
      });

      // Settle blocked transactions
      for (const txId of toSettle) {
        const blockedTx = blockedTxs.find((t) => t.id === txId)!;
        await tx.transaction.update({
          where: { id: txId },
          data: { pointsBlocked: false, pointsEarned: blockedTx.pointsOwed, settledAt: new Date() },
        });
        // Transfer points to customer
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: blockedTx.pointsOwed }, totalSpent: { increment: blockedTx.pointsOwed } },
        });
        await tx.membership.updateMany({
          where: { customerId: blockedTx.customerId!, businessId },
          data: { points: { increment: blockedTx.pointsOwed }, lifetimePts: { increment: blockedTx.pointsOwed } },
        });
        // Raffle tickets for settled points
        if (blockedTx.customerId && blockedTx.pointsOwed > 0) {
          const mem = await tx.membership.findUnique({
            where: { customerId_businessId: { customerId: blockedTx.customerId, businessId } },
          });
          const lifeBefore = (mem?.lifetimePts ?? 0) - blockedTx.pointsOwed;
          const ticketsBefore = Math.floor(Math.max(0, lifeBefore) / 100);
          const ticketsAfter = Math.floor((mem?.lifetimePts ?? 0) / 100);
          const newTickets = ticketsAfter - ticketsBefore;
          if (newTickets > 0) {
            const monthKey = new Date().toISOString().slice(0, 7);
            await tx.raffleTicket.createMany({
              data: Array.from({ length: newTickets }, () => ({
                customerId: blockedTx.customerId!, businessId, monthKey, fromSettlement: true,
              })),
            });
          }
        }
      }
    });

    return c.json({ ok: true, pts, cost, ptPrice, settledCount: toSettle.length });
  },
);

// ─── Get customers for a business ────────────────────────────────────────────

app.get("/:id/customers", async (c) => {
  const businessId = c.req.param("id");
  const memberships = await db.membership.findMany({
    where: { businessId },
    include: { customer: true },
    orderBy: { joinedAt: "desc" },
  });
  return c.json({ ok: true, memberships });
});

// ─── Get transactions for a business ─────────────────────────────────────────

app.get("/:id/transactions", async (c) => {
  const businessId = c.req.param("id");
  const transactions = await db.transaction.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return c.json({ ok: true, transactions });
});

// ─── Get tiers for a business ─────────────────────────────────────────────────

app.get("/:id/tiers", async (c) => {
  const businessId = c.req.param("id");
  const business = await db.business.findUnique({ where: { id: businessId } });
  if (!business) return errorResponse(c, 404, "Business not found");

  const curDef = CURRENCIES.find((x) => x.code === business.currency) ?? CURRENCIES[0];
  const tierDef = getMerchantTierDef(business.merchantTierKey);
  const returnRate = business.bizReturnRate ?? PLATFORM_DEFAULTS.returnRate;
  const redemptionRate = business.redemptionRate ?? curDef.redemptionRate;
  const tiers = buildScaledTiers(
    tierDef.key, returnRate, redemptionRate,
    business.creditFromBronze,
    business.vipMultipliers as number[] | null,
  );

  return c.json({ ok: true, tiers, merchantTierDef: tierDef });
});

// ─── Switch merchant tier ─────────────────────────────────────────────────────

app.post(
  "/:id/tier",
  zValidator("json", z.object({
    tierKey: z.enum(["micro", "growth", "sme", "enterprise"]),
  })),
  async (c) => {
    const businessId = c.req.param("id");
    const { tierKey } = c.req.valid("json");

    const business = await db.business.findUnique({ where: { id: businessId } });
    if (!business) return errorResponse(c, 404, "Business not found");

    const curDef = CURRENCIES.find((x) => x.code === business.currency) ?? CURRENCIES[0];
    const returnRate = business.bizReturnRate ?? PLATFORM_DEFAULTS.returnRate;
    const redemptionRate = business.redemptionRate ?? curDef.redemptionRate;
    const oldTiers = buildScaledTiers(business.merchantTierKey, returnRate, redemptionRate);

    // Protect existing members — floor them at their current tier level
    const memberships = await db.membership.findMany({ where: { businessId } });
    await db.$transaction(
      memberships.map((m) => {
        const currentLevel = oldTiers.find(
          (t) => (m.lifetimePts ?? 0) >= t.min && (m.lifetimePts ?? 0) <= t.max,
        )?.level ?? 1;
        const floor = Math.max(m.minTierLevel, currentLevel);
        return db.membership.update({ where: { id: m.id }, data: { minTierLevel: floor } });
      }),
    );

    await db.business.update({
      where: { id: businessId },
      data: { merchantTierKey: tierKey, updatedAt: new Date() },
    });

    return c.json({ ok: true });
  },
);

// ─── Churn signal ─────────────────────────────────────────────────────────────

app.get("/:id/churn", async (c) => {
  const { getMerchantChurnSignal } = await import("../lib/churn.js");
  const businessId = c.req.param("id");
  const [business, wallet, txs, ledger] = await Promise.all([
    db.business.findUnique({ where: { id: businessId } }),
    db.bizWallet.findUnique({ where: { businessId } }),
    db.transaction.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.ledgerEntry.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (!business) return errorResponse(c, 404, "Business not found");
  const signal = getMerchantChurnSignal(business, txs, wallet ?? {}, ledger);
  return c.json({ ok: true, signal });
});

export default app;
