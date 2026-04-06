import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";

const app = new Hono();

// ─── Create coalition ─────────────────────────────────────────────────────────

app.post(
  "/",
  zValidator("json", z.object({
    name:       z.string().min(1),
    businessId: z.string(),
  })),
  async (c) => {
    const { name, businessId } = c.req.valid("json");

    const coalition = await db.$transaction(async (tx) => {
      const coal = await tx.coalition.create({ data: { name } });
      await tx.business.update({
        where: { id: businessId },
        data: { type: "coalition", coalitionId: coal.id, coalitionSuspended: false },
      });
      return coal;
    });

    return c.json({ ok: true, coalition }, 201);
  },
);

// ─── List coalitions ──────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const coalitions = await db.coalition.findMany({
    include: { businesses: true },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, coalitions });
});

// ─── Get single coalition ─────────────────────────────────────────────────────

app.get("/:id", async (c) => {
  const coalition = await db.coalition.findUnique({
    where: { id: c.req.param("id") },
    include: { businesses: { include: { wallet: true } } },
  });
  if (!coalition) return errorResponse(c, 404, "Coalition not found");
  return c.json({ ok: true, coalition });
});

// ─── Join coalition ───────────────────────────────────────────────────────────

app.post(
  "/:id/join",
  zValidator("json", z.object({ businessId: z.string() })),
  async (c) => {
    const coalitionId = c.req.param("id");
    const { businessId } = c.req.valid("json");

    const business = await db.business.findUnique({ where: { id: businessId } });
    if (!business) return errorResponse(c, 404, "Business not found");
    if (business.coalitionId === coalitionId) {
      return c.json({ ok: false, reason: "Already a member" });
    }

    await db.business.update({
      where: { id: businessId },
      data: { type: "coalition", coalitionId, coalitionSuspended: false },
    });

    return c.json({ ok: true });
  },
);

// ─── Leave coalition ──────────────────────────────────────────────────────────

app.post(
  "/:id/leave",
  zValidator("json", z.object({ businessId: z.string() })),
  async (c) => {
    const { businessId } = c.req.valid("json");
    await db.business.update({
      where: { id: businessId },
      data: { type: "standalone", coalitionId: null, coalitionSuspended: false },
    });
    return c.json({ ok: true });
  },
);

export default app;
