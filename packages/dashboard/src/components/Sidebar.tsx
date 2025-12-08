"use client";

import { useAuth } from "./AuthProvider";
import { useAdmin } from "./AdminProvider";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const { user, signOut } = useAuth();
  const { isAdmin, adminRole } = useAdmin();
  const pathname = usePathname();

  // Don't show sidebar on login page
  if (pathname === "/login" || pathname.startsWith("/auth/")) {
    return null;
  }

  const isAdminPage = pathname.startsWith("/admin");

  return (
    <aside className={`w-64 border-r border-gray-800 p-4 flex flex-col ${isAdminPage ? "bg-purple-950/20" : ""}`}>
      <div className="mb-8">
        <h1 className="text-xl font-bold">Car Intel</h1>
        <p className="text-sm text-gray-400">
          {isAdminPage ? "Admin Panel" : "Dashboard"}
        </p>
      </div>

      {isAdminPage ? (
        <nav className="space-y-2 flex-1">
          <a
            href="/admin"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/admin" ? "bg-purple-900/50" : "hover:bg-gray-800"
            }`}
          >
            Overview
          </a>
          <a
            href="/admin/organizations"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/admin/organizations" ? "bg-purple-900/50" : "hover:bg-gray-800"
            }`}
          >
            Organizations
          </a>
          <a
            href="/admin/users"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/admin/users" ? "bg-purple-900/50" : "hover:bg-gray-800"
            }`}
          >
            Users
          </a>
          <a
            href="/admin/usage"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/admin/usage" ? "bg-purple-900/50" : "hover:bg-gray-800"
            }`}
          >
            Usage
          </a>
          <a
            href="/admin/invites"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/admin/invites" ? "bg-purple-900/50" : "hover:bg-gray-800"
            }`}
          >
            Invites
          </a>
          <a
            href="/admin/audit"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/admin/audit" ? "bg-purple-900/50" : "hover:bg-gray-800"
            }`}
          >
            Audit Log
          </a>

          <div className="pt-4 border-t border-gray-800 mt-4">
            <a
              href="/"
              className="block px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition"
            >
              Back to Dashboard
            </a>
          </div>
        </nav>
      ) : (
        <nav className="space-y-2 flex-1">
          <a
            href="/"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/" ? "bg-gray-800" : "hover:bg-gray-800"
            }`}
          >
            Overview
          </a>
          <a
            href="/keys"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/keys" ? "bg-gray-800" : "hover:bg-gray-800"
            }`}
          >
            API Keys
          </a>
          <a
            href="/usage"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/usage" ? "bg-gray-800" : "hover:bg-gray-800"
            }`}
          >
            Usage
          </a>
          <a
            href="/settings"
            className={`block px-4 py-2 rounded-lg transition ${
              pathname === "/settings" ? "bg-gray-800" : "hover:bg-gray-800"
            }`}
          >
            Settings
          </a>

          {isAdmin && (
            <div className="pt-4 border-t border-gray-800 mt-4">
              <a
                href="/admin"
                className="flex items-center gap-2 px-4 py-2 text-purple-400 hover:text-purple-300 rounded-lg hover:bg-gray-800 transition"
              >
                <span className="text-xs px-1.5 py-0.5 bg-purple-900 text-purple-300 rounded">
                  {adminRole === "super_admin" ? "Super" : adminRole === "admin" ? "Admin" : "Support"}
                </span>
                Admin Panel
              </a>
            </div>
          )}
        </nav>
      )}

      <div className="space-y-2 pt-4 border-t border-gray-800">
        <a
          href="https://docs.carintel.io"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm text-gray-400 hover:text-white transition"
        >
          API Documentation
        </a>
        {user && (
          <>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
            <button
              onClick={signOut}
              className="text-sm text-gray-400 hover:text-white transition"
            >
              Sign Out
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
