"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/utils/supabase/client";

type Mode = "sign-in" | "sign-up";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (!email || !password) {
        setError("Please enter email and password.");
        return;
      }

      if (mode === "sign-up") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        setInfo(
          "Sign up successful. If email confirmation is enabled, check your inbox."
        );
      } else {
        const {
          data: { session },
          error: signInError,
        } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError(signInError.message);
          return;
        }

        if (!session) {
          setError("No session returned. Please try again.");
          return;
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          setError(userError?.message ?? "Could not load user after login.");
          return;
        }

        setInfo(
          `Signed in as ${user.email ?? "unknown email"} (id: ${
            user.id
          }). Check console for session details.`
        );
        console.log("Supabase session after email/password login:", session);
      }
    } catch (err) {
      console.error("Unexpected auth error:", err);
      setError("Unexpected error, please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      setError(null);
      setInfo(null);
      setLoading(true);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Where Supabase should redirect BACK to after Google login.
          // This must be allowed in Supabase Auth URL config.
          redirectTo: `${window.location.origin}/login`,
        },
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // After this call, the browser will be redirected to Google.
      // Then Google -> Supabase callback -> back to redirectTo (your /login),
      // and Supabase will store the session in local storage/cookies.
    } catch (err) {
      console.error("Unexpected Google login error:", err);
      setError("Unexpected error during Google login.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">
        {mode === "sign-in" ? "Sign in" : "Create an account"}
      </h1>

      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className={`rounded-full px-3 py-1 ${
            mode === "sign-in"
              ? "bg-[#2c3a8a] text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          className={`rounded-full px-3 py-1 ${
            mode === "sign-up"
              ? "bg-[#2c3a8a] text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          Sign up
        </button>
      </div>

      {/* Google login */}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Simple Google icon-ish circle */}
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-xs">
          G
        </span>
        <span>Continue with Google</span>
      </button>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <div className="h-px flex-1 bg-gray-200" />
        <span>or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="text-sm font-medium text-gray-800">
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
            placeholder="you@example.com"
          />
        </label>

        <label className="text-sm font-medium text-gray-800">
          Password
          <input
            type="password"
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-black focus:ring-1 focus:ring-black"
            placeholder="••••••••"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-[#2c3a8a] px-4 text-sm font-medium text-white transition hover:bg-[#1f2a5f] disabled:cursor-not-allowed disabled:bg-gray-500"
        >
          {loading
            ? mode === "sign-in"
              ? "Signing in..."
              : "Creating account..."
            : mode === "sign-in"
            ? "Sign in"
            : "Sign up"}
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {info}
        </p>
      )}

      <p className="mt-2 text-xs text-gray-500">
        This screen is for development/testing only. Once your extension is
        wired to Supabase auth, you can remove this page.
      </p>
    </div>
  );
}
