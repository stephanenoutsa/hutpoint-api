import { randomBytes } from "node:crypto";

export function uid(): string {
  return randomBytes(6).toString("hex") + Date.now().toString(36);
}

export function referralCode(): string {
  return "HP" + randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
}

export function voucherCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

export function inviteCode(): string {
  return "INV" + randomBytes(3).toString("hex").toUpperCase();
}
