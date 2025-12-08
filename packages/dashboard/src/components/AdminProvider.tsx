"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

type AdminRole = "super_admin" | "admin" | "support" | null;

interface AdminContextType {
  isAdmin: boolean;
  adminRole: AdminRole;
  loading: boolean;
  checkAdminStatus: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType>({
  isAdmin: false,
  adminRole: null,
  loading: true,
  checkAdminStatus: async () => {},
});

export function useAdmin() {
  return useContext(AdminContext);
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [adminRole, setAdminRole] = useState<AdminRole>(null);
  const [loading, setLoading] = useState(true);

  const checkAdminStatus = useCallback(async () => {
    if (!user) {
      setAdminRole(null);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("admin_users")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error checking admin status:", error);
        setAdminRole(null);
      } else if (data) {
        setAdminRole(data.role as AdminRole);
      } else {
        setAdminRole(null);
      }
    } catch (err) {
      console.error("Error in checkAdminStatus:", err);
      setAdminRole(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    checkAdminStatus();
  }, [user, authLoading, checkAdminStatus]);

  const isAdmin = adminRole !== null;

  return (
    <AdminContext.Provider value={{ isAdmin, adminRole, loading, checkAdminStatus }}>
      {children}
    </AdminContext.Provider>
  );
}

export function canManage(role: AdminRole): boolean {
  return role === "super_admin" || role === "admin";
}

export function isSuperAdmin(role: AdminRole): boolean {
  return role === "super_admin";
}
