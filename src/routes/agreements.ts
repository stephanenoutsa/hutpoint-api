import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { inviteCode } from "../lib/id.js";
import { toJson } from "../lib/json.js";

const app = new Hono();

// ─── Create agreement ─────────────────────────────────────────────────────────

app.post(
  "/",
  zValidator("json", z.object({
    businessId:    z.string(),
    customerId:    z.string(),
    description:   z.string().min(1),
    amount:        z.number().nonnegative(),
    sym:           z.string().default("FCFA"),
    service:       z.string().optional(),
    paymentTerms:  z.string().optional(),
    serviceDate:   z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const business = await db.business.findUnique({ where: { id: data.businessId } });
    if (!business) return errorResponse(c, 404, "Business not found");

    const agreement = await db.$transaction(async (tx) => {
      const a = await tx.agreement.create({ data });
      await tx.activityLog.create({
        data: {
          businessId: data.businessId, role: "manager",
          action: "agreement",
          detail: `${data.sym} ${data.amount.toLocaleString()} - ${data.service ?? "Agreement"}`,
        },
      });
      return a;
    });

    return c.json({ ok: true, agreement }, 201);
  },
);

// ─── List agreements for a business ──────────────────────────────────────────

app.get("/business/:businessId", async (c) => {
  const agreements = await db.agreement.findMany({
    where: { businessId: c.req.param("businessId") },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, agreements });
});

// ─── List agreements for a customer ──────────────────────────────────────────

app.get("/customer/:customerId", async (c) => {
  const agreements = await db.agreement.findMany({
    where: { customerId: c.req.param("customerId") },
    include: { business: true },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, agreements });
});

// ─── Validate agreement ───────────────────────────────────────────────────────

app.post("/:id/validate", async (c) => {
  const agreement = await db.agreement.findUnique({ where: { id: c.req.param("id") } });
  if (!agreement) return errorResponse(c, 404, "Agreement not found");

  const bw = await db.bizWallet.findUnique({ where: { businessId: agreement.businessId } });
  const VALIDATE_PTS = 5;
  const hasFloat = (bw?.points ?? 0) >= VALIDATE_PTS;

  await db.$transaction(async (tx) => {
    await tx.agreement.update({
      where: { id: agreement.id },
      data: { status: "validated", validatedAt: new Date() },
    });
    await tx.membership.upsert({
      where: { customerId_businessId: { customerId: agreement.customerId, businessId: agreement.businessId } },
      create: { customerId: agreement.customerId, businessId: agreement.businessId },
      update: {},
    });
    if (hasFloat) {
      await tx.bizWallet.update({
        where: { businessId: agreement.businessId },
        data: { points: { decrement: VALIDATE_PTS }, totalSpent: { increment: VALIDATE_PTS } },
      });
      await tx.membership.update({
        where: { customerId_businessId: { customerId: agreement.customerId, businessId: agreement.businessId } },
        data: { points: { increment: VALIDATE_PTS }, lifetimePts: { increment: VALIDATE_PTS } },
      });
    }
  });

  return c.json({ ok: true, ptsAwarded: hasFloat ? VALIDATE_PTS : 0 });
});

// ─── Reject / void agreement ──────────────────────────────────────────────────

app.post(
  "/:id/reject",
  zValidator("json", z.object({ reason: z.string().optional() })),
  async (c) => {
    const { reason } = c.req.valid("json");
    await db.agreement.update({
      where: { id: c.req.param("id") },
      data: { status: "rejected", rejectReason: reason, rejectedAt: new Date() },
    });
    return c.json({ ok: true });
  },
);

app.post("/:id/void", async (c) => {
  await db.agreement.update({ where: { id: c.req.param("id") }, data: { status: "void" } });
  return c.json({ ok: true });
});

// ─── Add amendment ────────────────────────────────────────────────────────────

app.post(
  "/:id/amendments",
  zValidator("json", z.object({
    lineItems:      z.array(z.object({ description: z.string(), amount: z.number() })).min(1),
    paymentDueDate: z.string().optional(),
    note:           z.string().optional(),
  })),
  async (c) => {
    const { lineItems, paymentDueDate, note } = c.req.valid("json");
    const agreement = await db.agreement.findUnique({ where: { id: c.req.param("id") } });
    if (!agreement) return errorResponse(c, 404, "Agreement not found");

    const totalAmount = lineItems.reduce((s, l) => s + l.amount, 0);
    const amendment = {
      id: crypto.randomUUID(),
      lineItems, paymentDueDate: paymentDueDate ?? null, note: note ?? "",
      totalAmount, status: "pending_validation",
      createdAt: new Date().toISOString(),
    };

    const amendments = [...(agreement.amendments as object[]), amendment];
    await db.agreement.update({ where: { id: agreement.id }, data: { amendments: toJson(amendments) } });

    return c.json({ ok: true, amendment }, 201);
  },
);

// ─── Validate amendment ───────────────────────────────────────────────────────

app.post(
  "/:id/amendments/:amendId/validate",
  zValidator("json", z.object({ customerId: z.string() })),
  async (c) => {
    const { customerId } = c.req.valid("json");
    const agreement = await db.agreement.findUnique({ where: { id: c.req.param("id") } });
    if (!agreement) return errorResponse(c, 404, "Agreement not found");

    const amendments = agreement.amendments as Record<string, unknown>[];
    const idx = amendments.findIndex((a) => a["id"] === c.req.param("amendId"));
    if (idx === -1) return errorResponse(c, 404, "Amendment not found");

    amendments[idx] = { ...amendments[idx], status: "validated", validatedAt: new Date().toISOString() };

    const bw = await db.bizWallet.findUnique({ where: { businessId: agreement.businessId } });
    const AMEND_PTS = 5;
    const hasFloat = (bw?.points ?? 0) >= AMEND_PTS;

    await db.$transaction(async (tx) => {
      await tx.agreement.update({ where: { id: agreement.id }, data: { amendments: toJson(amendments) } });
      if (hasFloat) {
        await tx.bizWallet.update({
          where: { businessId: agreement.businessId },
          data: { points: { decrement: AMEND_PTS }, totalSpent: { increment: AMEND_PTS } },
        });
        await tx.membership.updateMany({
          where: { customerId, businessId: agreement.businessId },
          data: { points: { increment: AMEND_PTS }, lifetimePts: { increment: AMEND_PTS } },
        });
      }
    });

    return c.json({ ok: true });
  },
);

// ─── Reject amendment ─────────────────────────────────────────────────────────

app.post(
  "/:id/amendments/:amendId/reject",
  zValidator("json", z.object({ reason: z.string().optional() })),
  async (c) => {
    const { reason } = c.req.valid("json");
    const agreement = await db.agreement.findUnique({ where: { id: c.req.param("id") } });
    if (!agreement) return errorResponse(c, 404, "Agreement not found");

    const amendments = agreement.amendments as Record<string, unknown>[];
    const idx = amendments.findIndex((a) => a["id"] === c.req.param("amendId"));
    if (idx === -1) return errorResponse(c, 404, "Amendment not found");

    amendments[idx] = { ...amendments[idx], status: "rejected", rejectReason: reason, rejectedAt: new Date().toISOString() };
    await db.agreement.update({ where: { id: agreement.id }, data: { amendments: toJson(amendments) } });

    return c.json({ ok: true });
  },
);

// ─── Personal ledger ──────────────────────────────────────────────────────────

app.post(
  "/personal",
  zValidator("json", z.object({
    customerId:   z.string(),
    vendorName:   z.string().min(1),
    vendorPhone:  z.string().optional(),
    description:  z.string().min(1),
    totalAmount:  z.number().nonnegative(),
    paymentTerms: z.string().optional(),
    dueDate:      z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const record = await db.personalLedger.create({ data: { ...data, inviteCode: inviteCode() } });
    return c.json({ ok: true, record }, 201);
  },
);

app.get("/personal/customer/:customerId", async (c) => {
  const records = await db.personalLedger.findMany({
    where: { customerId: c.req.param("customerId") },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, records });
});

app.post(
  "/personal/:id/payment",
  zValidator("json", z.object({
    amount: z.number().positive(),
    note:   z.string().optional(),
    date:   z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const record = await db.personalLedger.findUnique({ where: { id: c.req.param("id") } });
    if (!record) return errorResponse(c, 404, "Record not found");

    const payment = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString() };
    const payments = [...(record.payments as object[]), payment];
    await db.personalLedger.update({ where: { id: record.id }, data: { payments: toJson(payments) } });

    return c.json({ ok: true, payment });
  },
);

app.post(
  "/personal/:id/amendment",
  zValidator("json", z.object({
    description:      z.string(),
    additionalAmount: z.number().nonnegative(),
    dueDate:          z.string().optional(),
    note:             z.string().optional(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    const record = await db.personalLedger.findUnique({ where: { id: c.req.param("id") } });
    if (!record) return errorResponse(c, 404, "Record not found");

    const amendment = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString() };
    const amendments = [...(record.amendments as object[]), amendment];
    await db.personalLedger.update({
      where: { id: record.id },
      data: { amendments: toJson(amendments), totalAmount: record.totalAmount + (data.additionalAmount ?? 0) },
    });

    return c.json({ ok: true, amendment });
  },
);

app.post("/personal/resolve-invite", zValidator("json", z.object({ code: z.string() })), async (c) => {
  const { code } = c.req.valid("json");
  const record = await db.personalLedger.findFirst({
    where: { inviteCode: code.trim().toUpperCase() },
    include: { customer: true },
  });
  if (!record) return errorResponse(c, 404, "Invite code not found");
  return c.json({ ok: true, record });
});

app.post("/personal/:id/mark-invite-sent", async (c) => {
  await db.personalLedger.update({
    where: { id: c.req.param("id") },
    data: { inviteSentAt: new Date() },
  });
  return c.json({ ok: true });
});

app.post(
  "/personal/:id/link",
  zValidator("json", z.object({ businessId: z.string(), customerId: z.string() })),
  async (c) => {
    const { businessId, customerId } = c.req.valid("json");
    const record = await db.personalLedger.findUnique({ where: { id: c.req.param("id") } });
    if (!record) return errorResponse(c, 404, "Record not found");

    const agreement = await db.$transaction(async (tx) => {
      await tx.personalLedger.update({
        where: { id: record.id },
        data: { linkedBusinessId: businessId, status: "linked" },
      });
      return tx.agreement.create({
        data: {
          businessId, customerId,
          description: record.description,
          amount: record.totalAmount,
          paymentTerms: record.paymentTerms ?? undefined,
          serviceDate: record.dueDate ?? undefined,
          fromPersonalRecord: true,
          personalRecordId: record.id,
        },
      });
    });

    return c.json({ ok: true, agreement });
  },
);

export default app;
