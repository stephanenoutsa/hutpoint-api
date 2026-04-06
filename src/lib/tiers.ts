// Ported from hutpoint/src/constants/tiers.js

export const MERCHANT_TIERS = [
  { key: "micro",      label: "Micro",      maxBasket: 25000,    margin: 0.50, merchantCost: 0.04,  avgBasket: 15000  },
  { key: "growth",     label: "Growth",     maxBasket: 150000,   margin: 0.65, merchantCost: 0.057, avgBasket: 75000  },
  { key: "sme",        label: "SME",        maxBasket: 500000,   margin: 0.75, merchantCost: 0.08,  avgBasket: 250000 },
  { key: "enterprise", label: "Enterprise", maxBasket: Infinity, margin: 0.80, merchantCost: 0.10,  avgBasket: 750000 },
] as const;

export type MerchantTierKey = (typeof MERCHANT_TIERS)[number]["key"];

export interface LoyaltyTier {
  level: number;
  name: string;
  min: number;
  max: number;
  icon: string;
  discount: number;
  ptsToRedeem: number;
  creditDays: number;
  b2b?: boolean;
}

export const PLATFORM_DEFAULTS = {
  returnRate: 0.02,
  platformMargin: 0.80,
  coalitionRedemptionRate: 2,
  spinPoolRate: 0.05,
  spinBoostThreshold: 3,
  spinWeights:      [{ pts: 1, w: 40 }, { pts: 5, w: 35 }, { pts: 10, w: 20 }, { pts: 20, w: 5  }],
  spinWeightsBoost: [{ pts: 1, w: 30 }, { pts: 5, w: 35 }, { pts: 10, w: 25 }, { pts: 20, w: 10 }],
};

export const EXPIRY_MONTHS: Record<number, number> = { 1: 6, 2: 9, 3: 12, 4: 18, 5: 24 };

export const CURRENCIES = [
  { code: "FCFA", symbol: "FCFA", name: "CFA Franc",           ptPrice: 50,  redemptionRate: 2 },
  { code: "KES",  symbol: "KSh",  name: "Kenyan Shilling",     ptPrice: 5,   redemptionRate: 2 },
  { code: "NGN",  symbol: "₦",    name: "Nigerian Naira",      ptPrice: 30,  redemptionRate: 2 },
  { code: "GHS",  symbol: "GH₵",  name: "Ghanaian Cedi",       ptPrice: 0.5, redemptionRate: 2 },
  { code: "ZAR",  symbol: "R",    name: "South African Rand",  ptPrice: 0.9, redemptionRate: 2 },
  { code: "USD",  symbol: "$",    name: "US Dollar",           ptPrice: 0.1, redemptionRate: 2 },
];

export function buildScaledTiers(
  merchantTierKey: string,
  returnRate = 0.02,
  redemptionRate = 2,
  creditFromBronze = false,
  vipMultipliers: number[] | null = null,
): LoyaltyTier[] {
  const t = MERCHANT_TIERS.find((t) => t.key === merchantTierKey) ?? MERCHANT_TIERS[0];
  const ppp = Math.max(1, Math.floor((t.avgBasket * returnRate) / redemptionRate));
  const ptsPerAvgTx = Math.max(1, Math.round(t.avgBasket / ppp));
  const TARGET_VISITS = vipMultipliers ?? [5, 13, 26, 52];
  const [b, s, g, p] = TARGET_VISITS.map((v) => v * ptsPerAvgTx);
  const r = ppp;
  return [
    { level: 1, name: "Starter",  min: 0, max: b - 1,        icon: "🥉", discount: 0,                  ptsToRedeem: 0,    creditDays: 0                      },
    { level: 2, name: "Bronze",   min: b, max: s - 1,         icon: "🥈", discount: r * redemptionRate,  ptsToRedeem: r,    creditDays: creditFromBronze ? 7 : 0  },
    { level: 3, name: "Silver",   min: s, max: g - 1,         icon: "💎", discount: r * 2 * redemptionRate, ptsToRedeem: r * 2, creditDays: creditFromBronze ? 14 : 7  },
    { level: 4, name: "Gold",     min: g, max: p - 1,         icon: "👑", discount: r * 4 * redemptionRate, ptsToRedeem: r * 4, creditDays: creditFromBronze ? 21 : 15 },
    { level: 5, name: "Platinum", min: p, max: 999_999_999,   icon: "⭐", discount: r * 8 * redemptionRate, ptsToRedeem: r * 8, creditDays: 30                     },
  ];
}

export function buildB2BTiers(
  merchantTierKey: string,
  returnRate = 0.02,
  redemptionRate = 2,
): LoyaltyTier[] {
  const ptPerFcfa = returnRate / redemptionRate;
  const [b, s, g, p] = [500_000, 2_000_000, 5_000_000, 10_000_000].map((v) =>
    Math.round(v * ptPerFcfa),
  );
  const r = Math.round(500_000 * ptPerFcfa);
  return [
    { level: 1, name: "Starter",  min: 0, max: b - 1,      icon: "🥉", discount: 0,                  ptsToRedeem: 0,    creditDays: 0,  b2b: true },
    { level: 2, name: "Bronze",   min: b, max: s - 1,       icon: "🥈", discount: r * redemptionRate,  ptsToRedeem: r,    creditDays: 7,  b2b: true },
    { level: 3, name: "Silver",   min: s, max: g - 1,       icon: "💎", discount: r * 2 * redemptionRate, ptsToRedeem: r * 2, creditDays: 14, b2b: true },
    { level: 4, name: "Gold",     min: g, max: p - 1,       icon: "👑", discount: r * 4 * redemptionRate, ptsToRedeem: r * 4, creditDays: 21, b2b: true },
    { level: 5, name: "Platinum", min: p, max: 999_999_999, icon: "⭐", discount: r * 8 * redemptionRate, ptsToRedeem: r * 8, creditDays: 30, b2b: true },
  ];
}

export function getTier(pts: number, tiers: LoyaltyTier[]): LoyaltyTier {
  return [...tiers].sort((a, b) => b.min - a.min).find((t) => pts >= t.min) ?? tiers[0];
}

export function calcPts(amount: number, returnRate: number, redemptionRate: number): number {
  return Math.max(1, Math.floor(amount * returnRate / redemptionRate));
}

export function wSpin(
  boost: boolean,
  weights = boost ? PLATFORM_DEFAULTS.spinWeightsBoost : PLATFORM_DEFAULTS.spinWeights,
): number {
  const r = Math.random() * 100;
  let c = 0;
  for (const w of weights) {
    c += w.w;
    if (r < c) return w.pts;
  }
  return 10;
}

export function getMerchantTierDef(merchantTierKey: string | null, avgBasket?: number) {
  if (merchantTierKey) {
    return MERCHANT_TIERS.find((t) => t.key === merchantTierKey) ?? MERCHANT_TIERS[0];
  }
  if (avgBasket !== undefined) {
    return MERCHANT_TIERS.find((t) => avgBasket <= t.maxBasket) ?? MERCHANT_TIERS[MERCHANT_TIERS.length - 1];
  }
  return MERCHANT_TIERS[0];
}
