import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/auth";
import { resolveUsagePolicy } from "@/utils/subscription";

function getUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getNextUtcMidnightIso(date: Date): string {
  const nextMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  );
  return new Date(nextMidnight).toISOString();
}

export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const policy = resolveUsagePolicy(user);
    const now = new Date();
    const today = getUtcDateString(now);

    let usedToday = 0;

    const { data: usageRow, error: usageError } = await supabase
      .from("job_analysis_usage")
      .select("usage_count")
      .eq("user_id", user.id)
      .eq("usage_date", today)
      .maybeSingle();

    if (usageError) {
      console.error("Failed to load usage row:", usageError);
    } else if (typeof usageRow?.usage_count === "number") {
      usedToday = usageRow.usage_count;
    }

    const remainingToday =
      policy.limit === null ? null : Math.max(policy.limit - usedToday, 0);

    const payload = {
      plan: policy.tier,
      limit: policy.limit,
      usedToday,
      remainingToday,
      resetAt: getNextUtcMidnightIso(now),
    } as const;

    const headers: Record<string, string> = {
      "X-Usage-Plan": policy.tier,
    };

    if (policy.limit !== null && remainingToday !== null) {
      headers["X-RateLimit-Limit"] = policy.limit.toString();
      headers["X-RateLimit-Remaining"] = remainingToday.toString();
    }

    return NextResponse.json(payload, { status: 200, headers });
  } catch (error) {
    console.error("Unexpected error in GET /api/usage:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
