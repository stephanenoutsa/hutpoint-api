import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { voucherCode } from "../lib/id.js";
import { CURRENCIES, PLATFORM_DEFAULTS } from "../lib/tiers.js";

const app = new Hono();

// ─── Request redemption ───────────────────────────────────────────────────────

app.post(
  "/",
  zValidator("json", z.object({
    customerId:  z.string(),
    businessId:  z.string(),
    ptsToRedeem: z.number().int().positive(),
    tierName:    z.string().optional(),
  })),
  async (c) => {
    const { customerId, businessId, ptsToRedeem, tierName } = c.req.valid("json");

    const [mem, business] = await Promise.all([
      db.membership.findUnique({ where: { customerId_businessId: { customerId, businessId } } }),
      db.business.findUnique({ where: { id: businessId } }),
    ]);

    if (!mem || mem.points < ptsToRedeem) {
      return errorResponse(c, 400, "Insufficient points");
    }

    const curDef = CURRENCIES.find((x) => x.code === (business?.currency ?? "FCFA")) ?? CURRENCIES[0];
    const redemptionRate = business?.redemptionRate ?? curDef.redemptionRate;
    const discount = Math.round(ptsToRedeem * redemptionRate);
    const code = voucherCode();

    const pending = await db.pendingRedemption.create({
      data: { customerId, businessId, discount, ptsToRedeem, tierName, code },
    });

    return c.json({ ok: true, code, discount, pending }, 201);
  },
);

// ─── Confirm redemption ───────────────────────────────────────────────────────

app.post("/:id/confirm", async (c) => {
  const pending = await db.pendingRedemption.findUnique({ where: { id: c.req.param("id") } });
  if (!pending || pending.status !== "pending") {
    return errorResponse(c, 400, "Invalid or already processed redemption");
  }

  const mem = await db.membership.findUnique({
    where: { customerId_businessId: { customerId: pending.customerId, businessId: pending.businessId } },
  });
  if (!mem || mem.points < pending.ptsToRedeem) {
    return errorResponse(c, 400, "Insufficient points at confirmation time");
  }

  const business = await db.business.findUnique({ where: { id: pending.businessId } });

  await db.$transaction(async (tx) => {
    await tx.pendingRedemption.update({
      where: { id: pending.id },
      data: { status: "confirmed", confirmedAt: new Date() },
    });
    await tx.membership.update({
      where: { id: mem.id },
      data: { points: { decrement: pending.ptsToRedeem } },
    });
    await tx.redemption.create({
      data: {
        customerId: pending.customerId,
        businessId: pending.businessId,
        discount: pending.discount,
        ptsToRedeem: pending.ptsToRedeem,
        tierName: pending.tierName,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        type: "reimbursement",
        businessId: pending.businessId,
        pts: pending.ptsToRedeem,
        amount: pending.discount,
        currency: business?.currency ?? "FCFA",
        sym: business?.currencySymbol ?? "FCFA",
        description: `Reimbursement: ${pending.tierName ?? "redemption"} — ${business?.businessName ?? ""}`,
      },
    });
  });

  return c.json({ ok: true });
});

// ─── Cancel redemption ────────────────────────────────────────────────────────

app.post("/:id/cancel", async (c) => {
  await db.pendingRedemption.update({
    where: { id: c.req.param("id") },
    data: { status: "cancelled" },
  });
  return c.json({ ok: true });
});

// ─── Direct redemption (no pending stage) ────────────────────────────────────

app.post(
  "/direct",
  zValidator("json", z.object({
    customerId:  z.string(),
    businessId:  z.string(),
    ptsToRedeem: z.number().int().positive(),
    tierName:    z.string().optional(),
  })),
  async (c) => {
    const { customerId, businessId, ptsToRedeem, tierName } = c.req.valid("json");

    const mem = await db.membership.findUnique({
      where: { customerId_businessId: { customerId, businessId } },
    });
    if (!mem || mem.points < ptsToRedeem) {
      return errorResponse(c, 400, "Insufficient points");
    }

    const [business] = await Promise.all([db.business.findUnique({ where: { id: businessId } })]);
    const curDef = CURRENCIES.find((x) => x.code === (business?.currency ?? "FCFA")) ?? CURRENCIES[0];
    const redemptionRate = business?.redemptionRate ?? curDef.redemptionRate;
    const discount = Math.round(ptsToRedeem * redemptionRate);

    await db.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: mem.id },
        data: { points: { decrement: ptsToRedeem } },
      });
      await tx.redemption.create({
        data: { customerId, businessId, discount, ptsToRedeem, tierName },
      });
    });

    return c.json({ ok: true, discount });
  },
);

// ─── List redemptions for a business ─────────────────────────────────────────

app.get("/business/:businessId", async (c) => {
  const redemptions = await db.redemption.findMany({
    where: { businessId: c.req.param("businessId") },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, redemptions });
});

export default app;
