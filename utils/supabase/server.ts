// utils/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for:
 * - Route Handlers (app/api/...)
 * - Server Components
 * - Server Actions
 *
 * Uses cookie-based sessions, following Supabase's
 * recommended Next.js App Router pattern.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll can be called in environments where mutating
            // cookies isn't allowed (e.g. some Server Components).
            // In our flow, middleware will keep sessions fresh.
          }
        },
      },
    }
  );
}
