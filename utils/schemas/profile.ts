// utils/schemas/profile.ts
import { z } from "zod";

export const PreferredToneSchema = z.enum(["neutral", "warm", "formal"]);

export const ProfileResponseSchema = z.object({
  full_name: z.string().nullable(),
  resume_text: z.string().nullable(),
  preferred_tone: PreferredToneSchema.nullable(),
  target_role: z.string().nullable(),
  location: z.string().nullable(),
});

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

export const ProfileUpdateSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  resume_text: z.string().min(30).optional(),
  preferred_tone: PreferredToneSchema.optional(),
  target_role: z.string().min(1).max(200).optional(),
  location: z.string().min(1).max(200).optional(),
});

export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
