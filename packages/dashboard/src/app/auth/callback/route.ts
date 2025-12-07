import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  console.log("[Auth Callback] Received request with code:", code ? "yes" : "no");

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[Auth Callback] Exchange result:", { hasSession: !!data.session, error });

    if (!error && data.session) {
      // Set auth cookies manually for the client
      const cookieStore = await cookies();

      // Set access token cookie
      cookieStore.set("sb-access-token", data.session.access_token, {
        path: "/",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: data.session.expires_in,
      });

      // Set refresh token cookie
      cookieStore.set("sb-refresh-token", data.session.refresh_token, {
        path: "/",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });

      console.log("[Auth Callback] Session established, redirecting to:", `${origin}${next}`);
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.log("[Auth Callback] Failed to exchange code:", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
