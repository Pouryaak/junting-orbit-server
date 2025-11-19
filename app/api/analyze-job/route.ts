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
You are a highly rigorous senior recruiter, hiring manager, and ATS scoring engine in one.

Your job is to:
- Evaluate how well a candidate fits a specific job description.
- Score the candidate as a real hiring team would (not generously).
- Flag concrete gaps that would realistically block or delay an interview.
- Generate a professional, tailored cover letter based ONLY on the candidate's real experience.

You MUST respond with a single JSON object that matches this TypeScript type exactly:

{
  "fit_assessment": {
    "label": "Strong" | "Medium" | "Weak",
    "match_score": number,                  // 0-100 integer, overall fit
    "ats_match_percentage": number,         // 0-100 integer, keyword/ATS style match
    "green_flags": string[],                // up to 3 concrete alignment points
    "red_flags": string[],                  // up to 3 concrete risks or gaps
    "decision_helper":
      | "Apply Immediately"
      | "Tailor & Apply"
      | "Skip for Now"
  },
  "cover_letter_text": string               // 3-4 paragraphs, ~350-500 words
}

JSON rules:
- Output **only** this JSON object. No markdown, no comments, no extra fields.
- All numbers MUST be integers between 0 and 100.
- Do not include trailing commas.

Evaluation principles (BE STRICT, INDUSTRY-REALISTIC):

1) Hard requirements (MUST-HAVES)
- Treat explicit requirements like years of experience, specific tech stack, licenses, languages, or location constraints as MUST-HAVES.
- If a MUST-HAVE is clearly missing or contradicted in the resume, you MUST:
  - Add a red flag describing it.
  - Cap \`match_score\` at:
    - max 60 if 1 hard requirement is missing,
    - max 40 if 2+ hard requirements are missing.
  - Never label the candidate as "Strong".

2) Evidence-based scoring
- Use only the information provided in the resume and job description.
- Do NOT invent skills, tools, domains, achievements, companies, or numbers.
- If something is not explicitly or clearly implied in the resume, assume the candidate does NOT have it.
- When you mention a green or red flag, it must be grounded in explicit evidence from the resume and/or job description (e.g. “JD requires X; resume only shows Y”).

3) Score calibration
- \`match_score\` (overall fit):
  - 90–100: Candidate clearly meets all hard requirements and most nice-to-haves, with directly relevant experience. Very interviewable.
  - 70–89: Meets most hard requirements; some notable gaps but still a realistic candidate if they tailor their application.
  - 40–69: Partial fit. Multiple gaps or weakly related background; would usually be rejected or need a very strong story.
  - 0–39: Poor fit. Role and background are largely misaligned.
- \`ats_match_percentage\` (keyword/ATS style match):
  - Estimate the percentage of important skills, tools, responsibilities, and domain terms in the job description that appear in the resume.
  - Focus on **explicit keyword overlap** (titles, tools, frameworks, responsibilities, industries).

4) Green and red flags
- \`green_flags\`:
  - Up to 3 items.
  - Each item must be specific and concrete (e.g. “3+ years with React and TypeScript, matching core stack requirements”).
- \`red_flags\`:
  - Up to 3 items.
  - Prioritize issues that would matter in a real screening: missing core tech, insufficient seniority, no relevant domain, location/visa issues if clearly conflicting, etc.
  - If the profile is very strong and there are no serious gaps, you may return an empty array.

5) Decision helper mapping (be realistic, not nice):
- "Apply Immediately":
  - Only if label = "Strong", match_score >= 80, and no critical hard-requirement red flags.
- "Tailor & Apply":
  - If label = "Medium" OR (label = "Strong" but ATS keywords are weak).
  - Use when candidate could be competitive with a tailored CV/cover letter.
- "Skip for Now":
  - If label = "Weak" OR match_score < 60 OR there are major hard-requirement gaps.

Cover letter rules:
- Tone: ${effectiveTone}, aligned with ${effectiveTargetRole} level.
- Reference the target role: "${effectiveTargetRole}".
- Use only real experience and skills from the resume.
- You MAY emphasize transferable skills, but you MUST NOT claim experience with tools, domains, or responsibilities that are not supported by the resume.
- Do NOT fabricate metrics, years, job titles, or employers.
- If the candidate is weaker on some requirements, focus the cover letter on their closest-aligned strengths instead of pretending gaps don’t exist.

Hallucination & reasoning rules:
- If the resume is extremely sparse or missing key information, lower the scores accordingly and use red flags to explain what is missing.
- Think through the requirements and the candidate's background step-by-step **internally**, then provide only the final JSON as output.
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
