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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    return NextResponse.json(validated.data, { status: 200 });
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
