// app/api/feedback/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/utils/supabase/server";
import { requireUser } from "@/utils/auth";
import {
  FeedbackCreateSchema,
  FeedbackResponseSchema,
  type FeedbackCreateInput,
} from "@/utils/schemas/feedback";

const toNullable = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const supabase = await createSupabaseServerClient();

    const contentType = req.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json(
        { error: "Unsupported media type" },
        { status: 415 }
      );
    }

    const json = (await req.json()) as unknown;
    const parsed = FeedbackCreateSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body: FeedbackCreateInput = parsed.data;

    const insertPayload = {
      user_id: user.id,
      type: body.type,
      title: body.title,
      description: body.description,
      steps_to_reproduce: toNullable(body.stepsToReproduce ?? null),
      expected_behavior: toNullable(body.expectedBehavior ?? null),
      actual_behavior: toNullable(body.actualBehavior ?? null),
      impact_level: body.impactLevel ?? null,
      environment: toNullable(body.environment ?? null),
      page_url: toNullable(body.pageUrl ?? null),
    };

    const { data, error } = await supabase
      .from("feedback_reports")
      .insert(insertPayload)
      .select("id, created_at")
      .maybeSingle();

    if (error || !data) {
      console.error("Failed to persist feedback:", error);
      return NextResponse.json(
        { error: "Failed to record feedback" },
        { status: 500 }
      );
    }

    if (!data.created_at) {
      console.error(
        "Feedback insert did not return created_at timestamp",
        data
      );
      return NextResponse.json(
        { error: "Failed to record feedback" },
        { status: 500 }
      );
    }

    const responsePayload = {
      feedbackId: data.id,
      status: "received" as const,
      submittedAt: data.created_at,
    };

    const validatedResponse = FeedbackResponseSchema.safeParse(responsePayload);

    if (!validatedResponse.success) {
      console.error(
        "Feedback response validation failed:",
        validatedResponse.error.flatten()
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }

    return NextResponse.json(validatedResponse.data, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Unexpected error in POST /api/feedback:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
