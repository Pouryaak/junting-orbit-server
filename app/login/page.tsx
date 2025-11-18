import { LoginForm } from "./LoginForm";
import { createSupabaseServerClient } from "@/utils/supabase/server";
import Image from "next/image";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthenticated = !!user;

  if (!isAuthenticated) {
    // Not signed in: show normal login/signup form
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center flex flex-col items-center">
            <Image
              src="/logo.svg"
              alt="Junting Orbit Logo"
              width={180}
              height={48}
              priority
              className="mb-4"
            />
            <p className="mt-2 text-sm text-gray-600">
              Sign in to connect your profile so the extension can analyze jobs
              for you.
            </p>
          </div>
          <LoginForm />
        </div>
      </main>
    );
  }

  // Already signed in: show "you're in" screen with guidance
  return (
    <main className="min-h-screen bg-linear-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-5xl">
        {/* Success card */}
        <div className="rounded-3xl bg-white shadow-xl border border-indigo-100 p-8 md:p-12 flex flex-col gap-8">
          {/* Header with logo */}
          <div className="flex flex-col items-center text-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-400 blur-2xl opacity-20 rounded-full"></div>
              <Image
                src="/logo-slogan.png"
                alt="Junting Orbit Logo"
                width={400}
                height={48}
                priority
                className="relative z-10"
              />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center justify-center gap-3">
                <span>🎉</span>
                You&apos;re All Set!
                <span>✨</span>
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl">
                Your Junting Orbit account is connected. Time to supercharge
                your job hunt!
              </p>
              {user?.email && (
                <p className="text-sm text-indigo-600 font-medium">
                  Signed in as {user.email}
                </p>
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="bg-linear-to-r from-indigo-50 to-blue-50 rounded-2xl p-6 border border-indigo-100">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 text-center">
              🚀 How to Use Junting Orbit
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="bg-white rounded-xl p-5 shadow-sm border border-indigo-50">
                <div className="h-8 w-8 flex items-center justify-center rounded-full bg-linear-to-br from-[#2c3a8a] to-[#4a5fc1] text-white font-bold mb-3">
                  1
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">
                  📌 Pin the Extension
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Click the puzzle icon in Chrome&apos;s toolbar, find{" "}
                  <span className="font-semibold text-[#2c3a8a]">
                    Junting Orbit
                  </span>
                  , and pin it for easy access.
                </p>
              </div>

              <div className="bg-white rounded-xl p-5 shadow-sm border border-indigo-50">
                <div className="h-8 w-8 flex items-center justify-center rounded-full bg-linear-to-br from-[#2c3a8a] to-[#4a5fc1] text-white font-bold mb-3">
                  2
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">
                  ⚙️ Set Up Your Profile
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Open the extension, go to{" "}
                  <span className="font-semibold text-[#2c3a8a]">Settings</span>
                  , add your name, resume, and preferred tone.
                </p>
              </div>

              <div className="bg-white rounded-xl p-5 shadow-sm border border-indigo-50">
                <div className="h-8 w-8 flex items-center justify-center rounded-full bg-linear-to-br from-[#2c3a8a] to-[#4a5fc1] text-white font-bold mb-3">
                  3
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">
                  🎯 Analyze Jobs
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Visit any job listing, click{" "}
                  <span className="font-semibold text-[#2c3a8a]">
                    Analyze Job
                  </span>
                  , and get your fit score + tailored cover letter!
                </p>
              </div>
            </div>
          </div>

          {/* Screenshots showcase */}
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-gray-900 text-center">
              See Junting Orbit in Action
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="group relative overflow-hidden rounded-xl border-2 border-gray-200 hover:border-[#2c3a8a] transition-all duration-300 hover:shadow-xl">
                <Image
                  src="/screenshot-1.png"
                  alt="Analyze job with instant fit score"
                  width={600}
                  height={400}
                  className="w-full h-auto transform group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm font-semibold">
                    📊 Instant Fit Analysis
                  </p>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl border-2 border-gray-200 hover:border-[#2c3a8a] transition-all duration-300 hover:shadow-xl">
                <Image
                  src="/screenshot-2.png"
                  alt="AI-generated cover letter"
                  width={600}
                  height={400}
                  className="w-full h-auto transform group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm font-semibold">
                    ✍️ Custom Cover Letters
                  </p>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl border-2 border-gray-200 hover:border-[#2c3a8a] transition-all duration-300 hover:shadow-xl">
                <Image
                  src="/screenshot-3.png"
                  alt="Personalized settings"
                  width={600}
                  height={400}
                  className="w-full h-auto transform group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm font-semibold">
                    🎨 Personalize Your Profile
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Call to action */}
          <div className="bg-linear-to-r from-[#2c3a8a] to-[#4a5fc1] rounded-2xl p-8 text-center text-white">
            <h3 className="text-2xl font-bold mb-3">
              Ready to Land Your Dream Job? 💼
            </h3>
            <p className="text-indigo-100 mb-6 text-lg">
              Head over to your favorite job board and start analyzing
              opportunities!
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <a
                href="https://www.linkedin.com/jobs/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-[#2c3a8a] px-6 py-3 rounded-full font-semibold hover:bg-indigo-50 transition-colors"
              >
                <span>🔗</span>
                LinkedIn Jobs
              </a>
              <a
                href="https://www.indeed.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-[#2c3a8a] px-6 py-3 rounded-full font-semibold hover:bg-indigo-50 transition-colors"
              >
                <span>💼</span>
                Indeed
              </a>
              <a
                href="https://www.glassdoor.com/Job/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white text-[#2c3a8a] px-6 py-3 rounded-full font-semibold hover:bg-indigo-50 transition-colors"
              >
                <span>🏢</span>
                Glassdoor
              </a>
            </div>
          </div>

          {/* Footer tip */}
          <div className="text-center text-sm text-gray-500">
            <p>
              💡 <span className="font-medium">Pro tip:</span> You can close
              this tab and come back anytime. Your session is saved!
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
