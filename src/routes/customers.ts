import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { referralCode } from "../lib/id.js";

const app = new Hono();

// ─── Register customer ────────────────────────────────────────────────────────

app.post(
  "/",
  zValidator("json", z.object({
    name:          z.string().min(1),
    phone:         z.string().min(1).transform(v => v.replace(/\s+/g, "")),
    email:         z.string().email().optional(),
    accountType:   z.enum(["personal", "business"]).default("personal"),
    referralInput: z.string().optional(),
  })),
  async (c) => {
    const { referralInput, ...data } = c.req.valid("json");

    const existing = await db.customer.findUnique({ where: { phone: data.phone } });
    if (existing) return errorResponse(c, 409, "Phone number already registered");

    let referredBy: string | null = null;
    if (referralInput) {
      const referrer = await db.customer.findFirst({
        where: { referralCode: referralInput.trim().toUpperCase() },
      });
      referredBy = referrer?.id ?? null;
    }

    const customer = await db.customer.create({
      data: { ...data, referralCode: referralCode(), referredBy },
    });
    return c.json({ ok: true, customer }, 201);
  },
);

// ─── Add customer inline (provisional) ───────────────────────────────────────

app.post(
  "/inline",
  zValidator("json", z.object({ phone: z.string().min(1).transform(v => v.replace(/\s+/g, "")) })),
  async (c) => {
    const { phone } = c.req.valid("json");
    const trimmed = phone.trim();
    const existing = await db.customer.findUnique({ where: { phone: trimmed } });
    if (existing) return c.json({ ok: true, customer: existing });

    const customer = await db.customer.create({
      data: {
        name: `Pending - ${trimmed}`,
        phone: trimmed,
        referralCode: referralCode(),
        provisional: true,
      },
    });
    return c.json({ ok: true, customer }, 201);
  },
);

// ─── List customers ───────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const customers = await db.customer.findMany({ orderBy: { createdAt: "desc" } });
  return c.json({ ok: true, customers });
});

// ─── Get single customer ──────────────────────────────────────────────────────

app.get("/:id", async (c) => {
  const customer = await db.customer.findUnique({
    where: { id: c.req.param("id") },
    include: { memberships: { include: { business: true } } },
  });
  if (!customer) return errorResponse(c, 404, "Customer not found");
  return c.json({ ok: true, customer });
});

// ─── Join a business (add membership) ────────────────────────────────────────

app.post(
  "/:id/join",
  zValidator("json", z.object({ businessId: z.string() })),
  async (c) => {
    const customerId = c.req.param("id");
    const { businessId } = c.req.valid("json");

    const [customer, business, wallet] = await Promise.all([
      db.customer.findUnique({ where: { id: customerId } }),
      db.business.findUnique({ where: { id: businessId } }),
      db.bizWallet.findUnique({ where: { businessId } }),
    ]);
    if (!customer) return errorResponse(c, 404, "Customer not found");
    if (!business) return errorResponse(c, 404, "Business not found");

    const existing = await db.membership.findUnique({
      where: { customerId_businessId: { customerId, businessId } },
    });
    if (existing) return c.json({ ok: true, membership: existing, alreadyJoined: true });

    const WELCOME_PTS = 10;
    const hasFloat = (wallet?.points ?? 0) >= WELCOME_PTS;

    const membership = await db.$transaction(async (tx) => {
      const mem = await tx.membership.create({ data: { customerId, businessId } });

      // Create coalition wallet if applicable
      if (business.coalitionId) {
        await tx.coalitionWallet.upsert({
          where: { customerId_coalitionId: { customerId, coalitionId: business.coalitionId } },
          create: { customerId, coalitionId: business.coalitionId },
          update: {},
        });
      }

      // Award welcome points
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId },
          data: { points: { decrement: WELCOME_PTS }, totalSpent: { increment: WELCOME_PTS } },
        });
        await tx.membership.update({
          where: { id: mem.id },
          data: { points: WELCOME_PTS, lifetimePts: WELCOME_PTS },
        });
      }
      return mem;
    });

    return c.json({ ok: true, membership }, 201);
  },
);

// ─── Get memberships (points balance per biz) ─────────────────────────────────

app.get("/:id/memberships", async (c) => {
  const memberships = await db.membership.findMany({
    where: { customerId: c.req.param("id") },
    include: { business: { include: { wallet: true } } },
  });
  return c.json({ ok: true, memberships });
});

// ─── Get spin tokens ──────────────────────────────────────────────────────────

app.get("/:id/spin-tokens", async (c) => {
  const tokens = await db.spinToken.findMany({
    where: { customerId: c.req.param("id"), used: false },
    include: { business: true, coalition: true },
  });
  return c.json({ ok: true, tokens });
});

// ─── Get raffle tickets ───────────────────────────────────────────────────────

app.get("/:id/raffle-tickets", async (c) => {
  const monthKey = new Date().toISOString().slice(0, 7);
  const tickets = await db.raffleTicket.findMany({
    where: { customerId: c.req.param("id"), monthKey, used: false },
  });
  return c.json({ ok: true, tickets, count: tickets.length });
});

// ─── Spin wheel ───────────────────────────────────────────────────────────────

app.post(
  "/:id/spin",
  zValidator("json", z.object({ tokenId: z.string() })),
  async (c) => {
    const { wSpin, PLATFORM_DEFAULTS } = await import("../lib/tiers.js");
    const customerId = c.req.param("id");
    const { tokenId } = c.req.valid("json");

    const token = await db.spinToken.findUnique({
      where: { id: tokenId },
      include: { coalition: true, business: true },
    });
    if (!token || token.customerId !== customerId || token.used) {
      return errorResponse(c, 400, "Invalid or already used token");
    }

    let boost = false;

    if (token.isCoal && token.coalitionId) {
      const coal = await db.coalition.findUnique({ where: { id: token.coalitionId } });
      if ((coal?.spinPool ?? 0) < 1) return errorResponse(c, 400, "Coalition spin pool is empty");
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const partners = await db.business.findMany({ where: { coalitionId: token.coalitionId } });
      const shoppedCount = await db.transaction.groupBy({
        by: ["businessId"],
        where: {
          customerId, createdAt: { gte: new Date(weekAgo) },
          businessId: { in: partners.map((b) => b.id) },
        },
      });
      boost = shoppedCount.length >= PLATFORM_DEFAULTS.spinBoostThreshold;
    } else if (token.businessId) {
      const bw = await db.bizWallet.findUnique({ where: { businessId: token.businessId } });
      if ((bw?.points ?? 0) < 1) return errorResponse(c, 400, "Business wallet too low for spin");
      boost = token.business?.surpriseMode ?? false;
    }

    const pts = wSpin(boost);

    await db.$transaction(async (tx) => {
      await tx.spinToken.update({ where: { id: tokenId }, data: { used: true, usedAt: new Date() } });

      await tx.transaction.create({
        data: {
          businessId: token.businessId ?? (await db.business.findFirst({ where: { coalitionId: token.coalitionId ?? undefined } }))!.id,
          customerId,
          amount: 0,
          description: `Spin win${boost ? " (Boosted)" : ""}`,
          type: "spin",
          pointsEarned: pts,
        },
      });

      if (token.isCoal && token.coalitionId) {
        await tx.coalition.update({
          where: { id: token.coalitionId },
          data: { spinPool: { decrement: pts } },
        });
        const anyBiz = await tx.business.findFirst({ where: { coalitionId: token.coalitionId } });
        if (anyBiz) {
          await tx.membership.updateMany({
            where: { customerId, businessId: anyBiz.id },
            data: { points: { increment: pts }, lifetimePts: { increment: pts } },
          });
        }
      } else if (token.businessId) {
        await tx.bizWallet.update({
          where: { businessId: token.businessId },
          data: { points: { decrement: pts }, totalSpent: { increment: pts } },
        });
        await tx.membership.updateMany({
          where: { customerId, businessId: token.businessId },
          data: { points: { increment: pts }, lifetimePts: { increment: pts } },
        });
      }
    });

    return c.json({ ok: true, pts, boost });
  },
);

// ─── Transfer points between businesses ──────────────────────────────────────

app.post(
  "/:id/transfer-points",
  zValidator("json", z.object({ fromBizId: z.string(), toBizId: z.string() })),
  async (c) => {
    const customerId = c.req.param("id");
    const { fromBizId, toBizId } = c.req.valid("json");
    if (fromBizId === toBizId) return errorResponse(c, 400, "Same business");

    const [fromMem, toBiz] = await Promise.all([
      db.membership.findUnique({ where: { customerId_businessId: { customerId, businessId: fromBizId } } }),
      db.business.findUnique({ where: { id: toBizId } }),
    ]);
    if (!fromMem || fromMem.points <= 0) return errorResponse(c, 400, "No points to transfer");
    if (!toBiz) return errorResponse(c, 404, "Destination business not found");

    const pts = fromMem.points;

    await db.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: fromMem.id }, data: { points: 0 } });
      await tx.membership.upsert({
        where: { customerId_businessId: { customerId, businessId: toBizId } },
        create: { customerId, businessId: toBizId, points: pts, lifetimePts: pts },
        update: { points: { increment: pts }, lifetimePts: { increment: pts } },
      });
      await tx.transaction.create({
        data: {
          businessId: toBizId, customerId, amount: 0,
          description: "Points rescue from " + fromBizId,
          type: "rescue_transfer", pointsEarned: pts,
        },
      });
    });

    return c.json({ ok: true, pts });
  },
);

export default app;
