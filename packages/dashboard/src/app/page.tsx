"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

interface UsageStats {
  totalRequests: number;
  remainingQuota: number;
  monthlyLimit: number;
  recentRequests: number;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      console.log("[Dashboard] loadStats starting, authLoading:", authLoading, "user:", !!user);

      // Wait for auth to finish loading
      if (authLoading) {
        console.log("[Dashboard] Auth still loading, waiting...");
        return;
      }

      if (!user) {
        console.log("[Dashboard] No user, setting loading false");
        setLoading(false);
        return;
      }

      try {
        // TODO: Fetch real usage data when organizations/usage tables exist
        // For now, show default stats for authenticated users
        console.log("[Dashboard] User authenticated, showing default stats");
        const monthlyLimit = 1000;

        setStats({
          totalRequests: 0,
          remainingQuota: monthlyLimit,
          monthlyLimit,
          recentRequests: 0,
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
  }, [user, authLoading]);

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
