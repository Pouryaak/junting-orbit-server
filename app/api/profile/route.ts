// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/auth";
import {
  ProfileResponseSchema,
  ProfileUpdateSchema,
  type ProfileUpdate,
} from "@/utils/schemas/profile";

/**
 * GET /api/profile
 * Returns the authenticated user's profile data.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, resume_text, preferred_tone, target_role, location")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching profile:", error);
      return NextResponse.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const rawProfile = data ?? {
      full_name: null,
      resume_text: null,
      preferred_tone: "neutral",
      target_role: null,
      location: null,
    };

    const parsed = ProfileResponseSchema.safeParse(rawProfile);

    if (!parsed.success) {
      console.error(
        "Profile data failed schema validation:",
        parsed.error.format()
      );
      return NextResponse.json(
        { error: "Profile data is invalid" },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed.data, { status: 200 });
  } catch (error) {
    console.error("Unauthorized profile access attempt:", error);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * PUT /api/profile
 * Creates or updates the authenticated user's profile.
 *
 * Body: partial updates, e.g.
 * {
 *   full_name?: string;
 *   resume_text?: string;
 *   preferred_tone?: 'neutral' | 'warm' | 'formal';
 *   target_role?: string;
 *   location?: string;
 * }
 */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    // 1) Parse and validate request body
    const json = (await req.json()) as unknown;
    const parsed = ProfileUpdateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updates: ProfileUpdate = parsed.data;

    // 2) Load existing profile (if any)
    const { data: existing, error: selectError } = await supabase
      .from("profiles")
      .select("full_name, resume_text, preferred_tone, target_role, location")
      .eq("id", user.id)
      .maybeSingle();

    if (selectError) {
      console.error("Error fetching existing profile for update:", selectError);
      return NextResponse.json(
        { error: "Failed to load existing profile" },
        { status: 500 }
      );
    }

    // 3) Merge existing + updates, with sensible defaults
    const mergedProfile = {
      id: user.id,
      full_name: updates.full_name ?? existing?.full_name ?? null,
      resume_text: updates.resume_text ?? existing?.resume_text ?? null,
      preferred_tone:
        updates.preferred_tone ?? existing?.preferred_tone ?? "neutral",
      target_role: updates.target_role ?? existing?.target_role ?? null,
      location: updates.location ?? existing?.location ?? null,
    };

    // 4) Upsert the profile row
    const { data: upserted, error: upsertError } = await supabase
      .from("profiles")
      .upsert(mergedProfile, { onConflict: "id" })
      .select("full_name, resume_text, preferred_tone, target_role, location")
      .maybeSingle();

    if (upsertError || !upserted) {
      console.error("Error upserting profile:", upsertError);
      return NextResponse.json(
        { error: "Failed to save profile" },
        { status: 500 }
      );
    }

    // 5) Validate the final shape before returning
    const validated = ProfileResponseSchema.safeParse(upserted);

    if (!validated.success) {
      console.error(
        "Upserted profile failed schema validation:",
        validated.error.format()
      );
      return NextResponse.json(
        { error: "Profile data is invalid after save" },
        { status: 500 }
      );
    }

    return NextResponse.json(validated.data, { status: 200 });
  } catch (error) {
    console.error(
      "Unauthorized profile update attempt or server error:",
      error
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
