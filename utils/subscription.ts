import type { User } from "@supabase/supabase-js";

export type PlanTier = "free" | "premium";

export type UsagePolicy = {
  tier: PlanTier;
  limit: number | null;
};

const PLAN_POLICIES: Record<PlanTier, UsagePolicy> = {
  free: { tier: "free", limit: 5 },
  premium: { tier: "premium", limit: null },
};

function normalizeTier(value: unknown): PlanTier | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.toLowerCase();

  if (normalized === "premium") {
    return "premium";
  }

  if (normalized === "free") {
    return "free";
  }

  return null;
}

export function resolvePlanTier(user: User): PlanTier {
  const candidates = [
    user.app_metadata?.subscriptionTier,
    user.app_metadata?.subscription_tier,
    user.user_metadata?.subscriptionTier,
    user.user_metadata?.subscription_tier,
  ];

  for (const candidate of candidates) {
    const tier = normalizeTier(candidate);
    if (tier) {
      return tier;
    }
  }

  return "free";
}

export function resolveUsagePolicy(user: User): UsagePolicy {
  const tier = resolvePlanTier(user);
  return PLAN_POLICIES[tier];
}
