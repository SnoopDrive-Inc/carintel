import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

// Singleton pattern to avoid creating multiple GoTrueClient instances
let supabaseClient: SupabaseClient | null = null;

// Use localStorage for browser client - this is the default and most reliable
// The server sets cookies via middleware, browser client uses localStorage
// On page load, the middleware refreshes the session and the client picks it up
export function createClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  supabaseClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true, // Let the client detect and handle OAuth callback
        flowType: "pkce",
      },
    }
  );

  return supabaseClient;
}
