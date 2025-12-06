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

  async function ensureOrganization(currentUser: User) {
    const supabase = createClient();

    // Check if user already has an organization
    const { data: existingOrg } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_user_id", currentUser.id)
      .single();

    if (existingOrg) {
      setOrganizationId(existingOrg.id);
      return;
    }

    // Create a new organization for the user
    const userName = currentUser.user_metadata?.full_name
      || currentUser.user_metadata?.name
      || currentUser.email?.split("@")[0]
      || "My Organization";

    const slug = `${userName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

    const { data: newOrg, error } = await supabase
      .from("organizations")
      .insert({
        name: `${userName}'s Organization`,
        slug,
        owner_user_id: currentUser.id,
        subscription_tier: "free",
        subscription_status: "active",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error creating organization:", error);
      return;
    }

    setOrganizationId(newOrg.id);
  }

  useEffect(() => {
    const supabase = createClient();

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);

      if (session?.user) {
        await ensureOrganization(session.user);
      }

      setLoading(false);

      // Redirect if not authenticated and not on public path
      if (!session?.user && !publicPaths.includes(pathname)) {
        router.push("/login");
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);

      if (session?.user) {
        await ensureOrganization(session.user);
      } else {
        setOrganizationId(null);
      }

      if (!session?.user && !publicPaths.includes(pathname)) {
        router.push("/login");
      }
    });

    return () => subscription.unsubscribe();
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
