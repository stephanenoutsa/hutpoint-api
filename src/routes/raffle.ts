import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db.js";
import { errorResponse } from "../middleware/error.js";
import { adminAuth } from "../middleware/auth.js";
import { PLATFORM_DEFAULTS } from "../lib/tiers.js";

const app = new Hono();

const MIN_BUYERS = 20;
const MIN_PRIZE  = 10_000;
const PRIZE_PCT  = 0.20;

// ─── Stats for current month ──────────────────────────────────────────────────

app.get("/stats", async (c) => {
  const monthKey = new Date().toISOString().slice(0, 7);

  const [tickets, draws, monthSales] = await Promise.all([
    db.raffleTicket.findMany({ where: { monthKey, used: false } }),
    db.raffleDraw.findMany({ orderBy: { createdAt: "desc" } }),
    db.transaction.aggregate({
      where: { type: "sale", createdAt: { gte: new Date(`${monthKey}-01`) } },
      _sum: { amount: true },
    }),
  ]);

  const uniqueBuyers = new Set(tickets.map((t) => t.customerId)).size;
  const totalTickets = tickets.length;
  const monthRevenue = monthSales._sum.amount ?? 0;
  const hutMargin = monthRevenue * PLATFORM_DEFAULTS.returnRate * 0.5;
  const prizePool = Math.floor(hutMargin * PRIZE_PCT);
  const canDraw = uniqueBuyers >= MIN_BUYERS && prizePool >= MIN_PRIZE;

  return c.json({
    ok: true,
    monthKey,
    uniqueBuyers,
    totalTickets,
    monthRevenue,
    hutMargin,
    prizePool,
    canDraw,
    draws,
  });
});

// ─── Run draw (admin-only) ────────────────────────────────────────────────────

app.post(
  "/draw",
  adminAuth,
  zValidator("json", z.object({ monthKey: z.string().regex(/^\d{4}-\d{2}$/) })),
  async (c) => {
    const { monthKey } = c.req.valid("json");

    const existingDraw = await db.raffleDraw.findUnique({ where: { monthKey } });
    if (existingDraw) return errorResponse(c, 409, "Draw already run for this month");

    const tickets = await db.raffleTicket.findMany({
      where: { monthKey, used: false },
    });
    const uniqueBuyerSet = new Set(tickets.map((t) => t.customerId));
    if (uniqueBuyerSet.size < MIN_BUYERS) {
      return c.json({ ok: false, reason: `Need ${MIN_BUYERS} unique buyers — only ${uniqueBuyerSet.size} this month.` });
    }

    const monthRevenue = (await db.transaction.aggregate({
      where: { type: "sale", createdAt: { gte: new Date(`${monthKey}-01`) } },
      _sum: { amount: true },
    }))._sum.amount ?? 0;

    const hutMargin = monthRevenue * PLATFORM_DEFAULTS.returnRate * 0.5;
    const prizePool = Math.floor(hutMargin * PRIZE_PCT);
    if (prizePool < MIN_PRIZE) {
      return c.json({ ok: false, reason: `Prize pool (FCFA ${prizePool.toLocaleString()}) below floor.` });
    }

    const pool = tickets.map((t) => t.customerId);
    const winnerId = pool[Math.floor(Math.random() * pool.length)];
    const winner = await db.customer.findUnique({ where: { id: winnerId } });

    const biggestTx = await db.transaction.findFirst({
      where: { customerId: winnerId, type: "sale", createdAt: { gte: new Date(`${monthKey}-01`) } },
      orderBy: { amount: "desc" },
    });

    const cashback = Math.min(prizePool, biggestTx?.amount ?? prizePool);

    const draw = await db.$transaction(async (tx) => {
      await tx.raffleTicket.updateMany({ where: { monthKey }, data: { used: true } });
      return tx.raffleDraw.create({
        data: {
          monthKey, winnerId,
          winnerName: winner?.name ?? "Unknown",
          biggestPurchase: biggestTx?.amount ?? 0,
          cashback, prizePool,
          uniqueBuyers: uniqueBuyerSet.size,
          totalTickets: tickets.length,
        },
      });
    });

    return c.json({ ok: true, draw });
  },
);

// ─── List past draws ──────────────────────────────────────────────────────────

app.get("/draws", async (c) => {
  const draws = await db.raffleDraw.findMany({ orderBy: { createdAt: "desc" } });
  return c.json({ ok: true, draws });
});

export default app;
