// app/api/analyze-job/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createSupabaseServerClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/auth";
import {
  AnalyzeJobRequestSchema,
  AnalyzeJobResponseSchema,
  type AnalyzeJobRequest,
} from "@/utils/schemas/analyzeJob";
import { resolveUsagePolicy } from "@/utils/subscription";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

type AnalysisRateLimitResult = {
  allowed: boolean;
  remaining: number;
};

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
- Separately evaluate:
  - (a) true role fit based on skills/experience, and
  - (b) ATS/keyword optimization and resume-writing quality.
- Generate a professional, tailored cover letter based ONLY on the candidate's real experience.

You MUST respond with a single JSON object that matches this TypeScript type exactly:

{
  "fit_assessment": {
    "label": "Strong" | "Medium" | "Weak",
    "match_score": number,                  // 0-100 integer, TRUE ROLE FIT
    "ats_match_percentage": number,         // 0-100 integer, ATS / KEYWORD / RESUME QUALITY
    "green_flags": string[],                // up to 3 concrete alignment points
    "red_flags": string[],                 // up to 3 concrete risks or gaps
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

==============================
SCORING DIMENSIONS – KEEP THEM SEPARATE
==============================

1) match_score (TRUE ROLE FIT – skills & experience only)
- Question: “Assuming the resume is readable, how well does this person actually fit this role?”
- Base this ONLY on:
  - Hard requirements (must-have skills, tech stack, years of experience, seniority level, location/visa if clearly stated).
  - Relevant responsibilities and scope (team size, ownership, complexity).
  - Domain relevance (e.g. fintech, healthcare, e-commerce) if described.
- Ignore:
  - Resume formatting.
  - How nicely things are worded.
  - Keyword stuffing vs. sparse wording.
- Calibration:
  - 90–100: Meets all hard requirements + most nice-to-haves; clearly strong, directly relevant experience.
  - 70–89: Meets most hard requirements; some gaps but realistic candidate.
  - 40–69: Partial fit; multiple important gaps or only indirectly related experience.
  - 0–39: Poor fit; role and background largely misaligned.

2) ats_match_percentage (ATS / KEYWORD / RESUME QUALITY)
- Question: “If this resume goes through an ATS, how likely is it to rank well based on keywords and structure, **even if the candidate is not an ideal fit**?”
- Base this on:
  - Presence of important keywords from the job description:
    - Tools, technologies, methodologies, domains, and responsibilities explicitly mentioned.
  - Clear sectioning (e.g. headings like “Experience”, “Education”, “Skills”) if visible in the text.
  - Use of role titles and dates that ATS can parse.
  - Avoidance of vague language and buzzwords without concrete skills.
- This score can be:
  - HIGH even if match_score is LOW (e.g., resume is keyword-rich but skills aren’t truly relevant).
  - LOW even if match_score is HIGH (e.g., strong background but poorly written, missing keywords).
- Calibration:
  - 90–100: Very strong keyword overlap + clear structure; looks highly ATS-optimized.
  - 70–89: Good overlap; some missing keywords or slightly inconsistent structure.
  - 40–69: Limited keyword overlap or weak structure; ATS performance likely mediocre.
  - 0–39: Very poor keyword coverage and/or structure; ATS likely to rank it low.

IMPORTANT:
- These two numbers should usually **not** be identical.
- They may coincide only when both the underlying fit and the ATS optimization are at a similar level (e.g., both clearly strong or both clearly poor).
- When in doubt, adjust them independently based on the definitions above rather than keeping them equal by default.

==============================
STRICT EVALUATION PRINCIPLES
==============================

Hard requirements (MUST-HAVES):
- Treat explicit requirements like years of experience, specific tech stack, licenses, languages, or location constraints as MUST-HAVES.
- If a MUST-HAVE is clearly missing or contradicted in the resume, you MUST:
  - Add a red flag describing it.
  - Cap \`match_score\` at:
    - max 60 if 1 hard requirement is missing,
    - max 40 if 2+ hard requirements are missing.
  - Never label the candidate as "Strong".

Evidence-based:
- Use only the information provided in the resume and job description.
- Do NOT invent skills, tools, domains, achievements, companies, or numbers.
- If something is not explicitly or clearly implied in the resume, assume the candidate does NOT have it.
- When you mention a green or red flag, it must be grounded in explicit evidence from the resume and/or job description (e.g. “JD requires X; resume only shows Y”).

Green & red flags:
- \`green_flags\` (up to 3):
  - Specific and concrete (e.g. “4+ years with React and TypeScript, matching core stack requirements”).
- \`red_flags\` (up to 3):
  - Real screening issues: missing core tech, insufficient seniority, no relevant domain, location/visa conflicts, etc.
  - If the profile is very strong and there are no serious gaps, you may return an empty array.

Decision helper mapping:
- "Apply Immediately":
  - Only if label = "Strong", match_score >= 80, and no critical hard-requirement red flags.
- "Tailor & Apply":
  - If label = "Medium" OR (label = "Strong" but ATS keywords are weak).
  - Use when candidate could be competitive with a tailored CV/cover letter.
- "Skip for Now":
  - If label = "Weak" OR match_score < 60 OR there are major hard-requirement gaps.

==============================
COVER LETTER RULES
==============================

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
