"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { usePathname, useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  organizationId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  organizationId: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const publicPaths = ["/login", "/auth/callback"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  async function ensureOrganization(currentUser: User): Promise<string | null> {
    try {
      const supabase = createClient();

      // Check if user already has an organization
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingOrg, error: fetchError } = await (supabase.from("organizations") as any)
        .select("id")
        .eq("owner_user_id", currentUser.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching organization:", fetchError);
        return null;
      }

      if (existingOrg) {
        return (existingOrg as { id: string }).id;
      }

      // Create a new organization for the user
      const userName = currentUser.user_metadata?.full_name
        || currentUser.user_metadata?.name
        || currentUser.email?.split("@")[0]
        || "My Organization";

      const slug = `${userName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newOrg, error: insertError } = await (supabase.from("organizations") as any)
        .insert({
          name: `${userName}'s Organization`,
          slug,
          owner_user_id: currentUser.id,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Error creating organization:", insertError);
        return null;
      }

      return (newOrg as { id: string }).id;
    } catch (err) {
      console.error("Unexpected error in ensureOrganization:", err);
      return null;
    }
  }

  useEffect(() => {
    console.log("[AuthProvider] useEffect starting, pathname:", pathname);
    const supabase = createClient();
    let initialCheckDone = false;

    // Listen for auth changes - this is the primary way we get auth state
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[AuthProvider] Auth state changed:", event, !!session?.user);

      if (session?.user) {
        setUser(session.user);
        // Don't block on organization fetch - do it async
        ensureOrganization(session.user).then(orgId => {
          setOrganizationId(orgId);
        });
      } else {
        setUser(null);
        setOrganizationId(null);
        if (!publicPaths.includes(pathname) && initialCheckDone) {
          router.push("/login");
        }
      }

      // Always set loading to false after we get an auth event
      setLoading(false);
      initialCheckDone = true;
    });

    // Set a timeout to ensure we don't hang forever
    const timeout = setTimeout(() => {
      console.log("[AuthProvider] Timeout - setting loading to false");
      setLoading(false);
      initialCheckDone = true;
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [pathname, router]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOrganizationId(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ user, organizationId, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
