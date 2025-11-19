import { z } from "zod";

export const FeedbackTypeSchema = z.enum(["bug", "feature"]);

export const FeedbackImpactSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

const requiredText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, { message: `Must be at least ${min} characters.` })
    .max(max, { message: `Must be ${max} characters or fewer.` });

const optionalText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, { message: `Must be at least ${min} characters.` })
    .max(max, { message: `Must be ${max} characters or fewer.` })
    .optional();

export const FeedbackCreateSchema = z
  .object({
    type: FeedbackTypeSchema,
    title: requiredText(3, 120),
    description: requiredText(20, 4000),
    stepsToReproduce: optionalText(10, 4000),
    expectedBehavior: optionalText(10, 2000),
    actualBehavior: optionalText(10, 2000),
    impactLevel: FeedbackImpactSchema.optional(),
    environment: optionalText(2, 200),
  })
  .superRefine((value, ctx) => {
    if (value.type === "bug" && !value.stepsToReproduce) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stepsToReproduce"],
        message: "Bug reports must include steps to reproduce.",
      });
    }
  });

export const FeedbackResponseSchema = z.object({
  feedbackId: z.string().uuid(),
  status: z.literal("received"),
  submittedAt: z.string().datetime(),
});

export type FeedbackCreateInput = z.infer<typeof FeedbackCreateSchema>;
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
