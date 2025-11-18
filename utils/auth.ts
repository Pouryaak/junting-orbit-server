// utils/auth.ts
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Get the currently authenticated user on the server.
 * Returns:
 * - User object if logged in
 * - null if not authenticated
 *
 * Never throws by itself – safe for optional-auth contexts.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    // Log or instrument this later if needed
    return null;
  }

  return user ?? null;
}

/**
 * Require an authenticated user.
 * - Returns the user if authenticated
 * - Throws an Error if not
 *
 * Use this in protected API routes and server actions.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    // Intentionally generic message – we don't leak
    // auth details or implementation to the client.
    throw new Error("Unauthorized");
  }

  return user;
}
