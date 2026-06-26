/**
 * Tier helpers — the SINGLE source of truth for paid-vs-free classification.
 *
 * Per the Pollinations docs the tier enum is:
 *   anonymous | microbe | spore | seed | flower | nectar | router
 * where `seed` is the automatic FREE tier granted on first login.
 * Only `flower` and `nectar` are paid/pilot tiers.
 *
 * (The old code wrongly counted `seed` as Pro in two places — this fixes it.)
 */

export const PAID_TIERS = ['flower', 'nectar'] as const;

export function isPaidTier(tier: string | null | undefined): boolean {
  return !!tier && (PAID_TIERS as readonly string[]).includes(tier.toLowerCase());
}

export interface TierMeta {
  key: string;
  label: string;
  paid: boolean;
}

const TIER_LABELS: Record<string, string> = {
  anonymous: 'Anonymous',
  microbe: 'Microbe',
  spore: 'Spore',
  seed: 'Seed',
  flower: 'Flower',
  nectar: 'Nectar',
  router: 'Router',
};

export function tierMeta(tier: string | null | undefined): TierMeta {
  const key = (tier ?? 'anonymous').toLowerCase();
  const fallback = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Unknown';
  return {
    key,
    label: TIER_LABELS[key] ?? fallback,
    paid: isPaidTier(key),
  };
}

/**
 * Human "refills in 6h 12m" string from an ISO timestamp.
 * Returns null when unknown or already past.
 */
export function formatRefill(nextResetAt: string | null | undefined): string | null {
  if (!nextResetAt) return null;
  const ts = Date.parse(nextResetAt);
  if (!Number.isFinite(ts)) return null;
  const diff = ts - Date.now();
  if (diff <= 0) return null;

  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hrs < 24) return remMin ? `${hrs}h ${remMin}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHr = hrs % 24;
  return remHr ? `${days}d ${remHr}h` : `${days}d`;
}
