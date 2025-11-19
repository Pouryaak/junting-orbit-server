// app/api/analyze-job/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/auth";
import {
  AnalyzeJobRequestSchema,
  AnalyzeJobResponseSchema,
  type AnalyzeJobRequest,
} from "@/utils/schemas/analyzeJob";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

type PlanTier = "free" | "premium";

type UsagePolicy = {
  tier: PlanTier;
  limit: number | null;
};

type AnalysisRateLimitResult = {
  allowed: boolean;
  remaining: number;
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

function resolvePlanTier(user: User): PlanTier {
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

function resolveUsagePolicy(user: User): UsagePolicy {
  const tier = resolvePlanTier(user);
  return PLAN_POLICIES[tier];
}

async function enforceDailyLimit(
  supabase: ServerSupabaseClient,
  userId: string,
  limit: number
): Promise<AnalysisRateLimitResult> {
  const { data, error } = await supabase.rpc("job_analysis_increment_usage", {
    p_user_id: userId,
    p_limit: limit,
  });

  if (error) {
    throw new Error(error.message ?? "Rate limit RPC failed");
  }

  if (!data) {
    throw new Error("Rate limit RPC returned empty result");
  }

  const result = data as AnalysisRateLimitResult;

  if (
    typeof result.allowed !== "boolean" ||
    typeof result.remaining !== "number"
  ) {
    throw new Error("Rate limit RPC returned malformed payload");
  }

  return result;
}

/**
 * POST /api/analyze-job
 *
 * Body:
 * {
 *   jobDescription: string;
 *   toneOverride?: 'neutral' | 'warm' | 'formal';
 *   targetRoleOverride?: string;
 * }
 *
 * Returns:
 * {
 *   fit_assessment: { ... },
 *   cover_letter_text: string
 * }
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    // 1) Parse and validate request body
    const json = (await req.json()) as unknown;
    const parsed = AnalyzeJobRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body: AnalyzeJobRequest = parsed.data;

    // 2) Load user profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, resume_text, preferred_tone, target_role, location")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Error fetching profile in analyze-job:", profileError);
      return NextResponse.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    if (!profile || !profile.resume_text) {
      return NextResponse.json(
        {
          error:
            "Missing resume in profile. Please save your resume in settings before analyzing jobs.",
        },
        { status: 400 }
      );
    }

    const effectiveTone =
      body.toneOverride ?? profile.preferred_tone ?? "neutral";
    const effectiveTargetRole =
      body.targetRoleOverride ?? profile.target_role ?? "your target role";

    const usagePolicy = resolveUsagePolicy(user);
    let remainingAnalyses: number | undefined;

    if (usagePolicy.limit !== null) {
      let rateLimitSnapshot: AnalysisRateLimitResult;

      try {
        rateLimitSnapshot = await enforceDailyLimit(
          supabase,
          user.id,
          usagePolicy.limit
        );
      } catch (limitError) {
        console.error("Failed to enforce daily analysis limit:", limitError);
        return NextResponse.json(
          { error: "Failed to record usage" },
          { status: 500 }
        );
      }

      if (!rateLimitSnapshot.allowed) {
        const limitHeaders: Record<string, string> = {
          "X-Usage-Plan": usagePolicy.tier,
          "X-RateLimit-Limit": usagePolicy.limit.toString(),
          "X-RateLimit-Remaining": Math.max(
            rateLimitSnapshot.remaining,
            0
          ).toString(),
        };

        return NextResponse.json(
          {
            error:
              "Daily analyze limit reached. Come back tomorrow or upgrade when premium launches.",
            tier: usagePolicy.tier,
            remaining: rateLimitSnapshot.remaining,
          },
          { status: 429, headers: limitHeaders }
        );
      }

      remainingAnalyses = rateLimitSnapshot.remaining;
    }

    // 3) Build prompt for the model
    const systemPrompt = `
You are an expert recruiter and ATS assistant.
Your job is to:
- Analyze how well a candidate fits a specific job description.
- Provide a clear fit assessment with scores and flags.
- Generate a professional, tailored cover letter based only on the candidate's real experience.

You MUST respond with a single JSON object that matches this TypeScript type exactly:

{
  "fit_assessment": {
    "label": "Strong" | "Medium" | "Weak",
    "match_score": number,                  // 0-100, overall fit
    "ats_match_percentage": number,         // 0-100, keyword/ATS style match
    "green_flags": string[],                // up to 3, concrete alignment points
    "red_flags": string[],                  // up to 3, concrete risks or gaps
    "decision_helper":
      | "Apply Immediately"
      | "Tailor & Apply"
      | "Skip for Now"
  },
  "cover_letter_text": string               // 3-4 paragraphs, ~350-500 words
}

Rules:
- Use only the information provided in the resume and job description.
- Do NOT invent fake achievements, companies, or numbers.
- If something is missing from the resume, treat it as a red flag or risk.
- Keep the tone ${effectiveTone} and aligned with junior/mid/senior professional roles.
- The cover letter should reference the target role: "${effectiveTargetRole}".
    `.trim();

    const userPrompt = `
JOB DESCRIPTION:
${body.jobDescription}

CANDIDATE PROFILE:
Name: ${profile.full_name ?? "The candidate"}
Location: ${profile.location ?? "Not specified"}
Target role: ${effectiveTargetRole}
Resume:
${profile.resume_text}

Now:
1) Analyze the fit.
2) Produce the JSON object exactly as described.
`.trim();

    // 4) Call OpenAI with JSON response format
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent) {
      console.error("OpenAI returned empty content for analyze-job");
      return NextResponse.json(
        { error: "Failed to generate analysis" },
        { status: 502 }
      );
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawContent);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON:", e, rawContent);
      return NextResponse.json(
        { error: "Model returned invalid JSON" },
        { status: 502 }
      );
    }

    // 5) Validate model output against our schema
    const validated = AnalyzeJobResponseSchema.safeParse(parsedJson);

    if (!validated.success) {
      console.error(
        "Model output failed schema validation:",
        validated.error.format(),
        rawContent
      );
      return NextResponse.json(
        { error: "Model output did not match expected schema" },
        { status: 502 }
      );
    }

    // 6) Return the validated response
    const responseHeaders: Record<string, string> = {
      "X-Usage-Plan": usagePolicy.tier,
    };

    if (usagePolicy.limit !== null && remainingAnalyses !== undefined) {
      responseHeaders["X-RateLimit-Limit"] = usagePolicy.limit.toString();
      responseHeaders["X-RateLimit-Remaining"] = Math.max(
        remainingAnalyses,
        0
      ).toString();
    }

    return NextResponse.json(validated.data, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Unexpected error in POST /api/analyze-job:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
