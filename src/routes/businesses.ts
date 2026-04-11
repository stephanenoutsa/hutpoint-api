import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { toNullableJson } from "../lib/json.js";
import {
  buildScaledTiers, buildB2BTiers, getMerchantTierDef,
  PLATFORM_DEFAULTS, MERCHANT_TIERS, CURRENCIES,
} from "../lib/tiers.js";

type Env = { Variables: { userId: string } };
const app = new Hono<Env>();

// ─── Register business ────────────────────────────────────────────────────────

app.post(
  "/",
  requireAuth,
  zValidator("json", z.object({
    businessName: z.string().min(1),
    industry:     z.string().min(1),
    currency:     z.string().default("FCFA"),
    currencySymbol: z.string().default("FCFA"),
    merchantTierKey: z.string().optional(),
  })),
  async (c) => {
    const userId = c.get("userId") as string;
    const data = c.req.valid("json");
    const TEST_PTS = 2000;

    const business = await db.business.create({
      data: {
        ...data,
        merchantTierKey: data.merchantTierKey ?? "micro",
        wallet: {
          create: { points: TEST_PTS, totalPurchased: TEST_PTS, testPoints: true },
        },
        members: {
          create: { userId, role: "owner" },
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

// ─── List members ─────────────────────────────────────────────────────────────

app.get("/:id/members", requireAuth, async (c) => {
  const businessId = c.req.param("id");
  const userId = c.get("userId") as string;

  const isMember = await db.businessMember.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });
  if (!isMember) return errorResponse(c, 403, "Forbidden");

  const members = await db.businessMember.findMany({
    where: { businessId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return c.json({ ok: true, members });
});

// ─── Invite member ────────────────────────────────────────────────────────────

const INVITE_ROLES = ["co_owner", "manager", "supervisor"] as const;
const PRIVILEGED_ROLES = ["owner", "co_owner"] as const;

app.post(
  "/:id/members/invite",
  requireAuth,
  zValidator("json", z.object({
    phone: z.string().min(1),
    role:  z.enum(INVITE_ROLES),
  })),
  async (c) => {
    const businessId = c.req.param("id");
    const inviterId = c.get("userId") as string;
    const { phone, role } = c.req.valid("json");

    // Only owners and co-owners can invite
    const inviter = await db.businessMember.findUnique({
      where: { userId_businessId: { userId: inviterId, businessId } },
    });
    if (!inviter || !(PRIVILEGED_ROLES as readonly string[]).includes(inviter.role)) {
      return errorResponse(c, 403, "Only owners and co-owners can invite members");
    }

    const target = await db.user.findUnique({ where: { phone } });
    if (!target) return errorResponse(c, 404, "No registered user found with that phone number");

    const already = await db.businessMember.findUnique({
      where: { userId_businessId: { userId: target.id, businessId } },
    });
    if (already) return errorResponse(c, 409, "User is already a member of this business");

    const member = await db.businessMember.create({
      data: { userId: target.id, businessId, role, invitedById: inviterId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });

    return c.json({ ok: true, member }, 201);
  },
);

// ─── Change member role ───────────────────────────────────────────────────────

app.patch(
  "/:id/members/:memberId/role",
  requireAuth,
  zValidator("json", z.object({ role: z.enum(INVITE_ROLES) })),
  async (c) => {
    const businessId  = c.req.param("id");
    const memberId    = c.req.param("memberId");
    const requesterId = c.get("userId") as string;
    const { role }    = c.req.valid("json");

    const requester = await db.businessMember.findUnique({
      where: { userId_businessId: { userId: requesterId, businessId } },
    });
    if (!requester || !(PRIVILEGED_ROLES as readonly string[]).includes(requester.role)) {
      return errorResponse(c, 403, "Only owners and co-owners can change roles");
    }

    const target = await db.businessMember.findUnique({ where: { id: memberId } });
    if (!target || target.businessId !== businessId) {
      return errorResponse(c, 404, "Member not found");
    }
    if (target.role === "owner") {
      return errorResponse(c, 403, "Cannot change the role of the business owner");
    }

    const updated = await db.businessMember.update({
      where: { id: memberId },
      data: { role },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
    });

    return c.json({ ok: true, member: updated });
  },
);

// ─── Remove member ────────────────────────────────────────────────────────────

app.delete(
  "/:id/members/:memberId",
  requireAuth,
  async (c) => {
    const businessId  = c.req.param("id");
    const memberId    = c.req.param("memberId");
    const requesterId = c.get("userId") as string;

    const requester = await db.businessMember.findUnique({
      where: { userId_businessId: { userId: requesterId, businessId } },
    });
    if (!requester || !(PRIVILEGED_ROLES as readonly string[]).includes(requester.role)) {
      return errorResponse(c, 403, "Only owners and co-owners can remove members");
    }

    const target = await db.businessMember.findUnique({ where: { id: memberId } });
    if (!target || target.businessId !== businessId) {
      return errorResponse(c, 404, "Member not found");
    }
    if (target.role === "owner") {
      return errorResponse(c, 403, "Cannot remove the business owner");
    }

    await db.businessMember.delete({ where: { id: memberId } });

    return c.json({ ok: true });
  },
);

export default app;
