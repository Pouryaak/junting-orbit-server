// utils/schemas/analyzeJob.ts
import { z } from "zod";

export const FitAssessmentSchema = z.object({
  label: z.enum(["Strong", "Medium", "Weak"]),
  match_score: z.number().min(0).max(100),
  ats_match_percentage: z.number().min(0).max(100),
  green_flags: z.array(z.string()).max(5),
  red_flags: z.array(z.string()).max(5),
  decision_helper: z.enum([
    "Apply Immediately",
    "Tailor & Apply",
    "Skip for Now",
  ]),
});

export type FitAssessment = z.infer<typeof FitAssessmentSchema>;

export const AnalyzeJobResponseSchema = z.object({
  fit_assessment: FitAssessmentSchema,
  cover_letter_text: z.string().min(50),
});

export type AnalyzeJobResponse = z.infer<typeof AnalyzeJobResponseSchema>;

export const AnalyzeJobRequestSchema = z.object({
  jobDescription: z.string().min(30),
  toneOverride: z.enum(["neutral", "warm", "formal"]).optional(),
  targetRoleOverride: z.string().optional(),
});

export type AnalyzeJobRequest = z.infer<typeof AnalyzeJobRequestSchema>;
