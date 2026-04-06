// Ported from hutpoint/src/utils/churn.js

const REAL_TX_TYPES = new Set([
  "sale", "rental", "service", "stay", "appointment",
  "order", "session", "consultation",
]);
const INTERNAL_TX_TYPES = new Set([
  "spin", "reorder_bonus", "reminder_bonus", "receipt_ack", "admin_gift",
]);

interface Tx { type: string; amount?: number; createdAt: string | Date; businessId?: string | null }
interface Wallet { points?: number; totalPurchased?: number }
interface LedgerEntry { type: string; businessId?: string | null; createdAt: string | Date }
interface Biz { id: string }

export function getMerchantChurnSignal(
  biz: Biz,
  bizTx: Tx[],
  bizWallet: Wallet,
  ledgerEntries: LedgerEntry[],
) {
  const realTxs = bizTx.filter(
    (t) => REAL_TX_TYPES.has(t.type) || (!INTERNAL_TX_TYPES.has(t.type) && (t.amount ?? 0) > 0),
  );
  const sorted = [...realTxs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const lastTx = sorted[0] ?? null;
  const daysSinceTx = lastTx
    ? Math.floor((Date.now() - new Date(lastTx.createdAt).getTime()) / 86_400_000)
    : null;

  const topUps = ledgerEntries
    .filter((e) => e.type === "revenue" && e.businessId === biz.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const lastTopUp = topUps[0] ?? null;
  const daysSinceTopUp = lastTopUp
    ? Math.floor((Date.now() - new Date(lastTopUp.createdAt).getTime()) / 86_400_000)
    : null;

  const walletPts = bizWallet.points ?? 0;
  const walletEmpty = walletPts === 0;
  const neverToppedUp = daysSinceTopUp === null && (bizWallet.totalPurchased ?? 0) <= 2000;
  const neverTransacted = daysSinceTx === null;

  let status: string, label: string, color: string, bg: string, border: string, reason: string;

  if (neverTransacted && neverToppedUp) {
    status = "never_started"; label = "Never Started";
    color = "#374151"; bg = "#f9fafb"; border = "#e5e7eb";
    reason = "Registered but has not logged a transaction.";
  } else if (neverTransacted || (daysSinceTx ?? 0) >= 90 || (walletEmpty && daysSinceTopUp !== null && daysSinceTopUp >= 90)) {
    status = "discontinued"; label = "Discontinued";
    color = "#3730a3"; bg = "#eef2ff"; border = "#c7d2fe";
    reason = neverTransacted
      ? "Never logged a transaction."
      : `No transaction in ${daysSinceTx} days.${walletEmpty ? " Wallet empty." : ""}`;
  } else if ((daysSinceTx ?? 0) >= 60 || (walletEmpty && daysSinceTopUp !== null && daysSinceTopUp >= 60)) {
    status = "at_risk"; label = "At Risk";
    color = "#991b1b"; bg = "#fee2e2"; border = "#fca5a5";
    reason = `Last transaction ${daysSinceTx} days ago.${walletEmpty ? " Wallet empty." : ""}`;
  } else if ((daysSinceTx ?? 0) >= 30 || (walletEmpty && daysSinceTopUp !== null && daysSinceTopUp >= 30)) {
    status = "dormant"; label = "Dormant";
    color = "#92400e"; bg = "#fef3c7"; border = "#fde68a";
    reason = `Last transaction ${daysSinceTx} days ago.`;
  } else {
    status = "active"; label = "Active";
    color = "#065f46"; bg = "#d1fae5"; border = "#6ee7b7";
    reason = `Last transaction ${daysSinceTx} day${daysSinceTx !== 1 ? "s" : ""} ago.`;
  }

  return {
    status, label, color, bg, border, reason,
    daysSinceTx, daysSinceTopUp, walletEmpty, walletPts,
    totalTransactions: realTxs.length,
    lastTxDate: lastTx?.createdAt ?? null,
  };
}
