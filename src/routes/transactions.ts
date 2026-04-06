import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { toNullableJson } from "../lib/json.js";
import {
  buildScaledTiers, getMerchantTierDef, calcPts,
  PLATFORM_DEFAULTS, CURRENCIES, EXPIRY_MONTHS, getTier,
} from "../lib/tiers.js";

const app = new Hono();

const TX_TYPES = [
  "sale", "rental", "service", "stay", "appointment",
  "order", "session", "consultation",
] as const;

// ─── Log a transaction ────────────────────────────────────────────────────────

app.post(
  "/",
  zValidator("json", z.object({
    businessId:  z.string(),
    customerId:  z.string(),
    amount:      z.number().positive(),
    description: z.string().optional(),
    type:        z.enum(TX_TYPES).default("sale"),
    lineItems:   z.array(z.record(z.unknown())).optional(),
    role:        z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const { businessId, customerId, amount, type, description, lineItems, role } = data;

    const [business, wallet, allBizTxs, activeBonus] = await Promise.all([
      db.business.findUnique({ where: { id: businessId } }),
      db.bizWallet.findUnique({ where: { businessId } }),
      db.transaction.findMany({
        where: { businessId, customerId, type: "sale" },
        orderBy: { createdAt: "desc" }, take: 1,
      }),
      db.bonus.findFirst({
        where: { customerId, businessId, used: false, expiresAt: { gt: new Date() } },
      }),
    ]);

    if (!business) return errorResponse(c, 404, "Business not found");

    // Ensure membership exists
    await db.membership.upsert({
      where: { customerId_businessId: { customerId, businessId } },
      create: { customerId, businessId },
      update: {},
    });
    if (business.coalitionId) {
      await db.coalitionWallet.upsert({
        where: { customerId_coalitionId: { customerId, coalitionId: business.coalitionId } },
        create: { customerId, coalitionId: business.coalitionId },
        update: {},
      });
    }

    const curDef = CURRENCIES.find((x) => x.code === business.currency) ?? CURRENCIES[0];
    const returnRate = business.bizReturnRate ?? PLATFORM_DEFAULTS.returnRate;
    const redemptionRate = business.redemptionRate ?? curDef.redemptionRate;
    const basePts = calcPts(amount, returnRate, redemptionRate);

    // Bonus multipliers
    const lastTx = allBizTxs[0];
    const daysSinceLast = lastTx
      ? Math.floor((Date.now() - new Date(lastTx.createdAt).getTime()) / 86_400_000)
      : 999;
    const thresholdHit = (business.spendThreshold ?? 0) > 0 && amount >= (business.spendThreshold ?? 0);
    const comebackHit = daysSinceLast >= (business.comebackWindowDays ?? 7) && !!lastTx;

    let multiplier = activeBonus ? activeBonus.multiplier : 1;
    if (thresholdHit) multiplier = Math.max(multiplier, 2);
    if (comebackHit) multiplier = Math.max(multiplier, 2);

    const pts = Math.round(basePts * multiplier);
    const hasFloat = (wallet?.points ?? 0) >= pts;
    const suspended = !!(business.coalitionId && business.coalitionSuspended);

    const bonusApplied = multiplier > 1 && hasFloat && !suspended;
    const bonusReason = bonusApplied
      ? thresholdHit && comebackHit ? "threshold+comeback"
        : thresholdHit ? "threshold"
        : comebackHit ? "comeback"
        : "first_visit"
      : null;

    const isFirstAtBiz = !(await db.transaction.findFirst({
      where: { customerId, businessId, NOT: { type: "spin" } },
    }));

    const result = await db.$transaction(async (tx) => {
      const newTx = await tx.transaction.create({
        data: {
          businessId, customerId, amount,
          description: description ?? "Sale",
          type,
          lineItems: toNullableJson(lineItems ?? null),
          pointsEarned: hasFloat && !suspended ? pts : 0,
          pointsOwed: !hasFloat && !suspended ? pts : 0,
          pointsBlocked: !hasFloat,
          bonusApplied, bonusReason,
          multiplier: bonusApplied ? multiplier : 1,
          coalitionSuspended: suspended,
        },
      });

      await tx.activityLog.create({
        data: {
          businessId, role: role ?? "manager",
          action: "transaction",
          detail: `${amount.toLocaleString()} - ${description ?? "Sale"}`,
        },
      });

      if (hasFloat && !suspended) {
        if (activeBonus) {
          await tx.bonus.update({ where: { id: activeBonus.id }, data: { used: true } });
        }

        // Welcome bonus for first visit at this biz
        if (isFirstAtBiz) {
          await tx.bonus.create({
            data: {
              customerId, businessId,
              type: "double_points", multiplier: 2,
              expiresAt: new Date(Date.now() + 14 * 86_400_000),
            },
          });
        }

        // Transfer points
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: pts }, totalSpent: { increment: pts } },
        });
        await tx.membership.update({
          where: { customerId_businessId: { customerId, businessId } },
          data: { points: { increment: pts }, lifetimePts: { increment: pts } },
        });

        // Coalition spin pool contribution
        if (business.coalitionId) {
          const spinPts = Math.floor(pts * PLATFORM_DEFAULTS.spinPoolRate);
          await tx.bizWallet.update({
            where: { businessId },
            data: { points: { decrement: spinPts } },
          });
          await tx.coalition.update({
            where: { id: business.coalitionId },
            data: { spinPool: { increment: spinPts } },
          });
          await tx.spinToken.create({
            data: { customerId, coalitionId: business.coalitionId, isCoal: true },
          });
        } else {
          await tx.spinToken.create({
            data: { customerId, businessId },
          });
        }

        // Referral reward — once per business
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (customer?.referredBy && isFirstAtBiz && !customer.referralFiredBizIds.includes(businessId)) {
          const referrerReward = Math.max(5, Math.round(pts * 0.5));
          const newCustBonus = business.newCustomerBonus ?? 10;
          // Reward referrer
          await tx.membership.upsert({
            where: { customerId_businessId: { customerId: customer.referredBy, businessId } },
            create: { customerId: customer.referredBy, businessId, points: referrerReward, lifetimePts: referrerReward },
            update: { points: { increment: referrerReward }, lifetimePts: { increment: referrerReward } },
          });
          // Reward new customer
          await tx.membership.update({
            where: { customerId_businessId: { customerId, businessId } },
            data: { points: { increment: newCustBonus }, lifetimePts: { increment: newCustBonus } },
          });
          await tx.customer.update({
            where: { id: customerId },
            data: { referralFiredBizIds: { push: businessId } },
          });
        }

        // Raffle tickets
        if (pts > 0) {
          const mem = await tx.membership.findUnique({
            where: { customerId_businessId: { customerId, businessId } },
          });
          const lifeBefore = (mem?.lifetimePts ?? 0) - pts;
          const newTickets = Math.floor((mem?.lifetimePts ?? 0) / 100) - Math.floor(Math.max(0, lifeBefore) / 100);
          if (newTickets > 0) {
            const monthKey = new Date().toISOString().slice(0, 7);
            await tx.raffleTicket.createMany({
              data: Array.from({ length: newTickets }, () => ({ customerId, businessId, monthKey })),
            });
          }
        }
      }

      return newTx;
    });

    return c.json({ ok: true, transaction: result, pts: hasFloat ? pts : 0, blocked: !hasFloat });
  },
);

// ─── Generate receipt ─────────────────────────────────────────────────────────

app.post(
  "/receipts",
  zValidator("json", z.object({
    transactionId: z.string().optional(),
    customerId:    z.string(),
    businessId:    z.string(),
    description:   z.string().optional(),
    amount:        z.number(),
    lineItems:     z.array(z.record(z.unknown())).optional(),
  })),
  async (c) => {
    const { lineItems, ...rest } = c.req.valid("json");
    const receipt = await db.receipt.create({ data: { ...rest, lineItems: toNullableJson(lineItems ?? null) } });
    return c.json({ ok: true, receipt }, 201);
  },
);

// ─── Acknowledge receipt ──────────────────────────────────────────────────────

app.post(
  "/receipts/:id/acknowledge",
  zValidator("json", z.object({ customerId: z.string() })),
  async (c) => {
    const { customerId } = c.req.valid("json");
    const receipt = await db.receipt.findUnique({ where: { id: c.req.param("id") } });
    if (!receipt) return errorResponse(c, 404, "Receipt not found");
    if (receipt.status === "acknowledged") return c.json({ ok: true, alreadyAcknowledged: true });

    const bw = await db.bizWallet.findUnique({ where: { businessId: receipt.businessId } });
    const ACK_PTS = 2;
    const hasFloat = (bw?.points ?? 0) >= ACK_PTS;

    await db.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receipt.id },
        data: { status: "acknowledged", acknowledgedAt: new Date() },
      });
      await tx.membership.upsert({
        where: { customerId_businessId: { customerId, businessId: receipt.businessId } },
        create: { customerId, businessId: receipt.businessId },
        update: {},
      });
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId: receipt.businessId },
          data: { points: { decrement: ACK_PTS }, totalSpent: { increment: ACK_PTS } },
        });
        await tx.membership.update({
          where: { customerId_businessId: { customerId, businessId: receipt.businessId } },
          data: { points: { increment: ACK_PTS }, lifetimePts: { increment: ACK_PTS } },
        });
        await tx.transaction.create({
          data: {
            businessId: receipt.businessId, customerId, amount: 0,
            description: "Receipt validated", type: "receipt_ack", pointsEarned: ACK_PTS,
          },
        });
      }
    });

    return c.json({ ok: true, ptsAwarded: hasFloat ? ACK_PTS : 0 });
  },
);

// ─── Scan receipt (customer-initiated) ────────────────────────────────────────

app.post(
  "/scan",
  zValidator("json", z.object({
    customerId:   z.string(),
    businessId:   z.string(),
    amount:       z.number().positive(),
    lineItems:    z.array(z.record(z.unknown())).optional(),
    receiptDate:  z.string(),
    receiptHash:  z.string(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const { customerId, businessId, amount, receiptDate, receiptHash, lineItems } = data;

    // Duplicate check
    const dup = await db.scannedReceipt.findUnique({ where: { receiptHash } });
    if (dup) return errorResponse(c, 409, "Receipt already scanned");

    // 48-hour window
    if (Date.now() - new Date(receiptDate).getTime() > 48 * 3_600_000) {
      return errorResponse(c, 422, "Receipt is older than 48 hours");
    }

    const [business, wallet] = await Promise.all([
      db.business.findUnique({ where: { id: businessId } }),
      db.bizWallet.findUnique({ where: { businessId } }),
    ]);
    if (!business) return errorResponse(c, 404, "Business not enrolled");

    const curDef = CURRENCIES.find((x) => x.code === business.currency) ?? CURRENCIES[0];
    const returnRate = business.bizReturnRate ?? PLATFORM_DEFAULTS.returnRate;
    const redemptionRate = business.redemptionRate ?? curDef.redemptionRate;

    const mem = await db.membership.findUnique({
      where: { customerId_businessId: { customerId, businessId } },
    });
    const lifePts = mem?.lifetimePts ?? 0;
    const tiers = buildScaledTiers(business.merchantTierKey, returnRate, redemptionRate);
    const tier = getTier(lifePts, tiers);
    const pts = Math.max(1, Math.round(amount / tier.ptsToRedeem || 1));
    const hasFloat = (wallet?.points ?? 0) >= pts;

    await db.$transaction(async (tx) => {
      await tx.scannedReceipt.create({
        data: {
          customerId, businessId, amount,
          lineItems: toNullableJson(lineItems ?? null),
          receiptDate, receiptHash,
          pointsIssued: hasFloat ? pts : 0,
          pointsOwed: hasFloat ? 0 : pts,
          deferred: !hasFloat,
        },
      });
      await tx.transaction.create({
        data: {
          businessId, customerId, amount,
          description: "Receipt scan", type: "sale",
          lineItems: toNullableJson(lineItems ?? null),
          pointsEarned: hasFloat ? pts : 0,
          pointsOwed: hasFloat ? 0 : pts,
          pointsBlocked: !hasFloat,
          fromReceiptScan: true,
        },
      });
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: pts }, totalSpent: { increment: pts } },
        });
        await tx.membership.upsert({
          where: { customerId_businessId: { customerId, businessId } },
          create: { customerId, businessId, points: pts, lifetimePts: pts },
          update: { points: { increment: pts }, lifetimePts: { increment: pts } },
        });
        // Raffle tickets
        const monthKey = new Date().toISOString().slice(0, 7);
        const lifetimeAfter = lifePts + pts;
        const newTickets = Math.floor(lifetimeAfter / 100) - Math.floor(lifePts / 100);
        if (newTickets > 0) {
          await tx.raffleTicket.createMany({
            data: Array.from({ length: newTickets }, () => ({
              customerId, businessId, monthKey, fromScan: true,
            })),
          });
        }
      }
    });

    return c.json({ ok: true, pts: hasFloat ? pts : 0, deferred: !hasFloat });
  },
);

// ─── Check & expire points ────────────────────────────────────────────────────

app.post("/expire-points", async (c) => {
  const GRACE_DAYS = 7;
  const now = Date.now();

  const memberships = await db.membership.findMany({
    where: { points: { gt: 0 } },
    include: { business: true },
  });

  const expired: string[] = [];

  for (const mem of memberships) {
    const biz = mem.business;
    const curDef = CURRENCIES.find((x) => x.code === biz.currency) ?? CURRENCIES[0];
    const returnRate = biz.bizReturnRate ?? PLATFORM_DEFAULTS.returnRate;
    const redemptionRate = biz.redemptionRate ?? curDef.redemptionRate;
    const tiers = buildScaledTiers(biz.merchantTierKey, returnRate, redemptionRate);
    const tier = getTier(mem.lifetimePts, tiers);
    const monthsWindow = EXPIRY_MONTHS[tier.level] ?? 6;

    const activityTxs = await db.transaction.findMany({
      where: {
        customerId: mem.customerId, businessId: mem.businessId,
        type: { in: ["sale", "rental", "service", "stay", "appointment", "order", "session", "consultation", "receipt_ack", "agreement_validated"] },
      },
      orderBy: { createdAt: "desc" }, take: 1,
    });

    const lastActivity = activityTxs[0]?.createdAt ?? mem.joinedAt;
    const expiryDate = new Date(lastActivity);
    expiryDate.setMonth(expiryDate.getMonth() + monthsWindow);
    const daysLeft = Math.floor((expiryDate.getTime() - now) / 86_400_000);

    if (daysLeft < 0) {
      // Grace period check
      if (daysLeft >= -GRACE_DAYS) {
        const graceCutoff = new Date(expiryDate.getTime() - GRACE_DAYS * 86_400_000);
        const graceActivity = await db.transaction.findFirst({
          where: { customerId: mem.customerId, businessId: mem.businessId, createdAt: { gte: graceCutoff } },
        });
        if (graceActivity) continue;
      }
      await db.$transaction(async (tx) => {
        const expiredPts = mem.points;
        await tx.membership.update({
          where: { id: mem.id },
          data: { points: 0, expiredAt: new Date(), expiredPts },
        });
        await tx.transaction.create({
          data: {
            businessId: mem.businessId, customerId: mem.customerId, amount: 0,
            description: `Points expired — ${monthsWindow} months inactivity`,
            type: "points_expired",
          },
        });
      });
      expired.push(mem.id);
    }
  }

  return c.json({ ok: true, expiredCount: expired.length });
});

// ─── Feedback ─────────────────────────────────────────────────────────────────

app.post(
  "/feedback/request",
  zValidator("json", z.object({
    businessId: z.string(),
    customerId: z.string(),
    receiptId:  z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const existing = await db.feedbackRequest.findUnique({
      where: { businessId_receiptId: { businessId: data.businessId, receiptId: data.receiptId ?? "" } },
    });
    if (existing) return c.json({ ok: false, reason: "Already requested" });
    const req = await db.feedbackRequest.create({ data });
    return c.json({ ok: true, request: req }, 201);
  },
);

app.post(
  "/feedback",
  zValidator("json", z.object({
    requestId:  z.string().optional(),
    customerId: z.string(),
    businessId: z.string(),
    receiptId:  z.string().optional(),
    rating:     z.number().int().min(1).max(5),
    comment:    z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const { requestId, customerId, businessId, receiptId, rating, comment } = data;

    const existing = await db.feedback.findFirst({
      where: { customerId, businessId, receiptId },
    });
    if (existing) return c.json({ ok: false, reason: "Already submitted" });

    const bw = await db.bizWallet.findUnique({ where: { businessId } });
    const FB_PTS = 5;
    const hasFloat = (bw?.points ?? 0) >= FB_PTS;

    await db.$transaction(async (tx) => {
      await tx.feedback.create({ data: { customerId, businessId, receiptId, rating, comment } });
      if (requestId) {
        await tx.feedbackRequest.update({ where: { id: requestId }, data: { status: "completed" } });
      }
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: FB_PTS }, totalSpent: { increment: FB_PTS } },
        });
        await tx.membership.updateMany({
          where: { customerId, businessId },
          data: { points: { increment: FB_PTS }, lifetimePts: { increment: FB_PTS } },
        });
      }
    });

    return c.json({ ok: true, ptsAwarded: hasFloat ? FB_PTS : 0 });
  },
);

// ─── Reminders ────────────────────────────────────────────────────────────────

app.post(
  "/reminders",
  zValidator("json", z.object({
    customerId:    z.string(),
    businessId:    z.string(),
    receiptId:     z.string().optional(),
    product:       z.string().optional(),
    days:          z.number().int().positive(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const { customerId, businessId, days } = data;
    const remindAt = new Date(Date.now() + Math.floor(days * 0.8) * 86_400_000);
    const bw = await db.bizWallet.findUnique({ where: { businessId } });
    const REMIND_PTS = 5;
    const hasFloat = (bw?.points ?? 0) >= REMIND_PTS;

    const reminder = await db.$transaction(async (tx) => {
      const r = await tx.reminder.create({ data: { ...data, remindAt } });
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: REMIND_PTS }, totalSpent: { increment: REMIND_PTS } },
        });
        await tx.membership.updateMany({
          where: { customerId, businessId },
          data: { points: { increment: REMIND_PTS }, lifetimePts: { increment: REMIND_PTS } },
        });
        await tx.transaction.create({
          data: {
            businessId, customerId, amount: 0,
            description: "Reminder bonus", type: "reminder_bonus", pointsEarned: REMIND_PTS,
          },
        });
      }
      return r;
    });

    return c.json({ ok: true, reminder });
  },
);

app.patch("/reminders/:id/dismiss", async (c) => {
  await db.reminder.update({ where: { id: c.req.param("id") }, data: { dismissed: true } });
  return c.json({ ok: true });
});

// ─── Reorder requests ─────────────────────────────────────────────────────────

app.post(
  "/reorders",
  zValidator("json", z.object({
    customerId:    z.string(),
    businessId:    z.string(),
    product:       z.string().optional(),
    transactionId: z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const { customerId, businessId, transactionId } = data;

    if (transactionId) {
      const existing = await db.reorderRequest.findFirst({
        where: { transactionId, customerId, status: { in: ["pending", "fulfilled"] } },
      });
      if (existing) return c.json({ ok: false, reason: "Already requested" });
    }

    const bw = await db.bizWallet.findUnique({ where: { businessId } });
    const REORDER_PTS = 5;
    const hasFloat = (bw?.points ?? 0) >= REORDER_PTS;

    const reorder = await db.$transaction(async (tx) => {
      const r = await tx.reorderRequest.create({ data });
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: REORDER_PTS }, totalSpent: { increment: REORDER_PTS } },
        });
        await tx.membership.updateMany({
          where: { customerId, businessId },
          data: { points: { increment: REORDER_PTS }, lifetimePts: { increment: REORDER_PTS } },
        });
        await tx.transaction.create({
          data: {
            businessId, customerId, amount: 0,
            description: "Reorder bonus", type: "reorder_bonus", pointsEarned: REORDER_PTS,
          },
        });
      }
      return r;
    });

    return c.json({ ok: true, reorder });
  },
);

app.patch("/reorders/:id/fulfill", async (c) => {
  await db.reorderRequest.update({ where: { id: c.req.param("id") }, data: { status: "fulfilled" } });
  return c.json({ ok: true });
});

export default app;
