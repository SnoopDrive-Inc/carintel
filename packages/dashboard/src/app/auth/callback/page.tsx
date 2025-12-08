"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[Auth Callback] Page loaded, URL:", window.location.href);

    const supabase = createClient();

    // Listen for auth state changes - Supabase will automatically
    // process the code in the URL when detectSessionInUrl is true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[Auth Callback] Auth state change:", event, !!session);

      if (event === "SIGNED_IN" && session) {
        console.log("[Auth Callback] User signed in, redirecting...");
        router.push("/");
      } else if (event === "TOKEN_REFRESHED") {
        // Token was refreshed, user is still signed in
        console.log("[Auth Callback] Token refreshed");
      }
    });

    // Also check if already signed in (in case the event already fired)
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      console.log("[Auth Callback] Initial session check:", !!session, sessionError?.message);
      if (session) {
        router.push("/");
      } else if (sessionError) {
        setError(sessionError.message);
      }
    });

    // Set a timeout to show error if nothing happens
    const timeout = setTimeout(() => {
      setError("Authentication timed out. Please try again.");
    }, 15000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <h1 className="text-xl font-bold text-red-500 mb-2">Authentication Error</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/login")}
            className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-gray-400">Completing sign in...</p>
      </div>
    </div>
  );
}
