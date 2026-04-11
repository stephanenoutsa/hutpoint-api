import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { adminAuth } from "../middleware/auth.js";
import { errorResponse } from "../middleware/error.js";
import { CURRENCIES, PLATFORM_DEFAULTS } from "../lib/tiers.js";
import { toJson } from "../lib/json.js";

const DEFAULT_CONFIG = {
  returnRate: PLATFORM_DEFAULTS.returnRate,
  platformMargin: PLATFORM_DEFAULTS.platformMargin,
  coalitionRedemptionRate: PLATFORM_DEFAULTS.coalitionRedemptionRate,
  currencies: toJson(CURRENCIES),
};

const app = new Hono();

// All admin routes require the API key
app.use("*", adminAuth);

// ─── Platform config ──────────────────────────────────────────────────────────

app.get("/config", async (c) => {
  const config = await db.platformConfig.findUnique({ where: { id: "singleton" } });
  return c.json({ ok: true, config: config ?? DEFAULT_CONFIG });
});

app.patch(
  "/config",
  zValidator("json", z.object({
    returnRate:              z.number().optional(),
    platformMargin:          z.number().optional(),
    coalitionRedemptionRate: z.number().optional(),
    currencies:              z.array(z.record(z.unknown())).optional(),
  })),
  async (c) => {
    const { currencies, ...rest } = c.req.valid("json");
    const safeData = { ...rest, ...(currencies ? { currencies: toJson(currencies) } : {}) };
    const config = await db.platformConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...DEFAULT_CONFIG, ...safeData },
      update: safeData,
    });
    return c.json({ ok: true, config });
  },
);

app.patch(
  "/config/currency/:code",
  zValidator("json", z.object({ ptPrice: z.number().optional(), redemptionRate: z.number().optional() })),
  async (c) => {
    const code = c.req.param("code");
    const updates = c.req.valid("json");
    const config = await db.platformConfig.findUnique({ where: { id: "singleton" } });
    const currencies = (config?.currencies as Record<string, unknown>[]) ?? CURRENCIES;
    const updated = currencies.map((cur) =>
      cur["code"] === code ? { ...cur, ...updates } : cur,
    );
    await db.platformConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...DEFAULT_CONFIG },
      update: { currencies: toJson(updated) },
    });
    return c.json({ ok: true });
  },
);

// ─── Gift points to business wallet ──────────────────────────────────────────

app.post(
  "/gift/business",
  zValidator("json", z.object({
    businessId: z.string(),
    pts:        z.number().int().positive(),
    reason:     z.string().optional(),
  })),
  async (c) => {
    const { businessId, pts, reason } = c.req.valid("json");
    await db.$transaction(async (tx) => {
      await tx.bizWallet.update({
        where: { businessId },
        data: { points: { increment: pts }, totalPurchased: { increment: pts } },
      });
      await tx.transaction.create({
        data: {
          businessId, customerId: null,
          amount: 0,
          description: `Admin gift: ${reason ?? ""}`,
          type: "admin_gift", pointsEarned: pts,
        },
      });
    });
    return c.json({ ok: true });
  },
);

// ─── Gift points to customers ─────────────────────────────────────────────────

app.post(
  "/gift/customers",
  zValidator("json", z.object({
    customerIds: z.array(z.string()).min(1),
    pts:         z.number().int().positive(),
    businessId:  z.string(),
  })),
  async (c) => {
    const { customerIds, pts, businessId } = c.req.valid("json");
    await db.$transaction(
      customerIds.map((cid) =>
        db.membership.upsert({
          where: { customerId_businessId: { customerId: cid, businessId } },
          create: { customerId: cid, businessId, points: pts, lifetimePts: pts },
          update: { points: { increment: pts }, lifetimePts: { increment: pts } },
        }),
      ),
    );
    return c.json({ ok: true, count: customerIds.length });
  },
);

// ─── Gift to coalition spin pool ──────────────────────────────────────────────

app.post(
  "/gift/coalition",
  zValidator("json", z.object({
    coalitionId: z.string(),
    pts:         z.number().int().positive(),
  })),
  async (c) => {
    const { coalitionId, pts } = c.req.valid("json");
    await db.coalition.update({
      where: { id: coalitionId },
      data: { spinPool: { increment: pts } },
    });
    return c.json({ ok: true });
  },
);

// ─── Suspend / reinstate business ────────────────────────────────────────────

app.patch(
  "/businesses/:id/suspend",
  zValidator("json", z.object({ suspended: z.boolean() })),
  async (c) => {
    const { suspended } = c.req.valid("json");
    await db.business.update({ where: { id: c.req.param("id") }, data: { suspended } });
    return c.json({ ok: true });
  },
);

app.patch(
  "/businesses/:id/suspend-coalition",
  zValidator("json", z.object({ suspended: z.boolean() })),
  async (c) => {
    const { suspended } = c.req.valid("json");
    await db.business.update({
      where: { id: c.req.param("id") },
      data: { coalitionSuspended: suspended },
    });
    return c.json({ ok: true });
  },
);

// ─── Set merchant tier ────────────────────────────────────────────────────────

app.patch(
  "/businesses/:id/merchant-tier",
  zValidator("json", z.object({ tierKey: z.enum(["micro", "growth", "sme", "enterprise"]) })),
  async (c) => {
    const { tierKey } = c.req.valid("json");
    await db.business.update({ where: { id: c.req.param("id") }, data: { merchantTierKey: tierKey } });
    return c.json({ ok: true });
  },
);

// ─── Overview stats ───────────────────────────────────────────────────────────

app.get("/stats", async (c) => {
  const [bizCount, custCount, txCount, userCount, revenue] = await Promise.all([
    db.business.count(),
    db.customer.count(),
    db.transaction.count(),
    db.user.count(),
    db.transaction.aggregate({ where: { type: "sale" }, _sum: { amount: true } }),
  ]);
  return c.json({
    ok: true,
    stats: {
      businesses: bizCount,
      customers: custCount,
      transactions: txCount,
      users: userCount,
      totalRevenue: revenue._sum.amount ?? 0,
    },
  });
});

// ─── Activity log ─────────────────────────────────────────────────────────────

app.get("/activity", async (c) => {
  const logs = await db.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { business: true },
  });
  return c.json({ ok: true, logs });
});

// ─── Platform user management ─────────────────────────────────────────────────

// Bootstrap: grant admin to a user by phone (x-admin-key only — used once to set up the first admin)
app.post(
  "/make-admin",
  zValidator("json", z.object({ phone: z.string().min(1).transform(v => v.replace(/\s+/g, "")) })),
  async (c) => {
    const { phone } = c.req.valid("json");
    const user = await db.user.findUnique({ where: { phone } });
    if (!user) return errorResponse(c, 404, "No registered user with that phone number");
    const updated = await db.user.update({
      where: { phone },
      data: { isAdmin: true },
    });
    return c.json({
      ok: true,
      user: { id: updated.id, firstName: updated.firstName, lastName: updated.lastName, phone: updated.phone, isAdmin: updated.isAdmin },
    });
  },
);

// List all registered users (with admin status)
app.get("/users", async (c) => {
  const users = await db.user.findMany({
    select: {
      id: true, firstName: true, lastName: true, phone: true,
      isAdmin: true, createdAt: true,
      _count: { select: { businessMembers: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, users });
});

// Toggle admin status for a user
app.patch("/users/:id/toggle-admin", async (c) => {
  const id = c.req.param("id");
  const user = await db.user.findUnique({ where: { id }, select: { id: true, isAdmin: true } });
  if (!user) return errorResponse(c, 404, "User not found");
  const updated = await db.user.update({
    where: { id },
    data: { isAdmin: !user.isAdmin },
    select: { id: true, firstName: true, lastName: true, phone: true, isAdmin: true },
  });
  return c.json({ ok: true, user: updated });
});

export default app;
