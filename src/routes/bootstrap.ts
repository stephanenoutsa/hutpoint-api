import { Hono } from "hono";
import { db } from "../db.js";
import { CURRENCIES, PLATFORM_DEFAULTS } from "../lib/tiers.js";

const app = new Hono();

/**
 * GET /bootstrap
 * Returns all application state in a single request.
 * The frontend uses this to hydrate on mount and re-sync after mutations.
 */
app.get("/", async (c) => {
  const [
    businessesRaw,
    customers,
    transactions,
    memberships,
    coalitions,
    coalWallets,
    agreements,
    receipts,
    feedback,
    feedbackRequests,
    redemptions,
    pendingRedemptions,
    ledgerEntries,
    spinTokens,
    reminders,
    bonuses,
    reorderRequests,
    raffleTickets,
    raffleDraws,
    activityLog,
    personalLedger,
    scannedReceipts,
    platformConfigRaw,
  ] = await Promise.all([
    db.business.findMany({ include: { wallet: true }, orderBy: { createdAt: "desc" } }),
    db.customer.findMany({ orderBy: { createdAt: "desc" } }),
    db.transaction.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    db.membership.findMany(),
    db.coalition.findMany({ orderBy: { createdAt: "desc" } }),
    db.coalitionWallet.findMany(),
    db.agreement.findMany({ orderBy: { createdAt: "desc" } }),
    db.receipt.findMany({ orderBy: { createdAt: "desc" } }),
    db.feedback.findMany({ orderBy: { createdAt: "desc" } }),
    db.feedbackRequest.findMany({ orderBy: { createdAt: "desc" } }),
    db.redemption.findMany({ orderBy: { createdAt: "desc" } }),
    db.pendingRedemption.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.ledgerEntry.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.spinToken.findMany({ where: { used: false } }),
    db.reminder.findMany({ where: { dismissed: false } }),
    db.bonus.findMany({ where: { used: false, expiresAt: { gt: new Date() } } }),
    db.reorderRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.raffleTicket.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
    db.raffleDraw.findMany({ orderBy: { createdAt: "desc" } }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.personalLedger.findMany({ orderBy: { createdAt: "desc" } }),
    db.scannedReceipt.findMany({ orderBy: { scannedAt: "desc" }, take: 200 }),
    db.platformConfig.findUnique({ where: { id: "singleton" } }),
  ]);

  // Separate wallet from business objects (frontend expects them as two arrays)
  const bizWallets = businessesRaw.map((b) => b.wallet).filter(Boolean);
  const businesses = businessesRaw.map(({ wallet: _w, ...b }) => b);

  const platformConfig = platformConfigRaw ?? {
    returnRate: PLATFORM_DEFAULTS.returnRate,
    platformMargin: PLATFORM_DEFAULTS.platformMargin,
    coalitionRedemptionRate: PLATFORM_DEFAULTS.coalitionRedemptionRate,
    currencies: CURRENCIES,
  };

  return c.json({
    ok: true,
    businesses,
    customers,
    transactions,
    memberships,
    coalitions,
    coalWallets,
    bizWallets,
    agreements,
    receipts,
    feedback,
    feedbackRequests,
    redemptions,
    pendingRedemptions,
    ledgerEntries,
    spinTokens,
    reminders,
    bonuses,
    reorderRequests,
    raffleTickets,
    raffleDraws,
    activityLog,
    personalLedger,
    scannedReceipts,
    platformConfig,
  });
});

export default app;
