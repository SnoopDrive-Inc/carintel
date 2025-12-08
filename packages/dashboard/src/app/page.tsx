"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

interface UsageStats {
  totalRequests: number;
  remainingQuota: number;
  monthlyLimit: number;
  recentRequests: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      console.log("[Dashboard] loadStats starting");
      try {
        const supabase = createClient();

        // Get current user's organization
        console.log("[Dashboard] Getting user...");
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        console.log("[Dashboard] getUser result:", { hasUser: !!user, error: userError });

        if (!user) {
          console.log("[Dashboard] No user, setting loading false");
          setLoading(false);
          return;
        }

        // Get organization (without joining subscription_tiers for now)
        console.log("[Dashboard] Getting organization for user:", user.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: org, error: orgError } = await (supabase.from("organizations") as any)
          .select("id")
          .eq("owner_user_id", user.id)
          .maybeSingle();

        console.log("[Dashboard] Organization result:", { org, error: orgError });

        if (orgError) {
          console.error("[Dashboard] Error fetching organization:", orgError);
          setLoading(false);
          return;
        }

        if (!org) {
          console.log("[Dashboard] No organization found");
          // Still show dashboard with zero stats
          setStats({
            totalRequests: 0,
            remainingQuota: 1000,
            monthlyLimit: 1000,
            recentRequests: 0,
          });
          setLoading(false);
          return;
        }

        // Get current month's usage
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        console.log("[Dashboard] Getting usage data...");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: usage, error: usageError } = await (supabase.from("usage_daily") as any)
          .select("request_count, tokens_used")
          .eq("organization_id", (org as { id: string }).id)
          .gte("date", startOfMonth.toISOString().split("T")[0]);

        console.log("[Dashboard] Usage result:", { usage, error: usageError });

        const totalRequests = (usage as { request_count: number }[])?.reduce((sum, u) => sum + u.request_count, 0) || 0;
        const monthlyLimit = 1000; // Default limit for now

        setStats({
          totalRequests,
          remainingQuota: Math.max(0, monthlyLimit - totalRequests),
          monthlyLimit,
          recentRequests: (usage as { request_count: number }[])?.slice(-7).reduce((sum, u) => sum + u.request_count, 0) || 0,
        });
        console.log("[Dashboard] Stats set successfully");
      } catch (err) {
        console.error("[Dashboard] Error loading stats:", err);
      } finally {
        setLoading(false);
        console.log("[Dashboard] Loading set to false");
      }
    }

    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Dashboard</h1>

      {!stats ? (
        <div className="bg-gray-900 rounded-lg p-6 text-center">
          <p className="text-gray-400 mb-4">
            Sign in to view your API usage statistics
          </p>
          <a
            href="/login"
            className="inline-block px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
          >
            Sign In
          </a>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-gray-900 rounded-lg p-6">
              <p className="text-sm text-gray-400 mb-1">This Month</p>
              <p className="text-3xl font-bold">
                {stats.totalRequests.toLocaleString()}
              </p>
              <p className="text-sm text-gray-400">requests</p>
            </div>

            <div className="bg-gray-900 rounded-lg p-6">
              <p className="text-sm text-gray-400 mb-1">Remaining Quota</p>
              <p className="text-3xl font-bold">
                {stats.remainingQuota.toLocaleString()}
              </p>
              <p className="text-sm text-gray-400">
                of {stats.monthlyLimit.toLocaleString()}
              </p>
            </div>

            <div className="bg-gray-900 rounded-lg p-6">
              <p className="text-sm text-gray-400 mb-1">Last 7 Days</p>
              <p className="text-3xl font-bold">
                {stats.recentRequests.toLocaleString()}
              </p>
              <p className="text-sm text-gray-400">requests</p>
            </div>
          </div>

          {/* Usage bar */}
          <div className="bg-gray-900 rounded-lg p-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Usage</span>
              <span>
                {Math.round((stats.totalRequests / stats.monthlyLimit) * 100)}%
              </span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-600 rounded-full transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    (stats.totalRequests / stats.monthlyLimit) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
