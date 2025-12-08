"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

interface Organization {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  subscription_status: string;
  created_at: string;
}

interface Tier {
  id: string;
  name: string;
  monthly_price_cents: number;
  monthly_token_limit: number | null;
  rate_limit_per_minute: number;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("");

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const supabase = createClient();
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    if (!currentUser) {
      setLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgData } = await (supabase.from("organizations") as any)
      .select("*, subscription_tiers(*)")
      .eq("owner_user_id", currentUser.id)
      .single();

    if (orgData) {
      setOrg(orgData as Organization);
      setOrgName((orgData as Organization).name);
      setTier(orgData.subscription_tiers as Tier);

      // Load members
      const { data: membersData } = await supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("organization_id", orgData.id);

      setMembers(membersData || []);

      // Load pending invites
      const { data: invitesData } = await supabase
        .from("user_invites")
        .select("id, email, role, expires_at, accepted_at")
        .eq("organization_id", orgData.id)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString());

      setInvites(invitesData || []);
    }
    setLoading(false);
  }

  async function saveSettings() {
    if (!org || !orgName.trim()) return;

    setSaving(true);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("organizations") as any)
      .update({ name: orgName })
      .eq("id", org.id);
    setSaving(false);
  }

  function generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleInvite() {
    if (!org || !inviteEmail.trim() || !user) return;

    setInviting(true);
    try {
      const supabase = createClient();
      const token = generateToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { error } = await supabase.from("user_invites").insert({
        email: inviteEmail.trim().toLowerCase(),
        organization_id: org.id,
        role: inviteRole,
        invited_by: user.id,
        token,
        expires_at: expiresAt.toISOString(),
      });

      if (error) {
        console.error("Error creating invite:", error);
        alert("Failed to create invite: " + error.message);
        return;
      }

      const inviteLink = `${window.location.origin}/invite/${token}`;
      alert(`Invite created! Share this link:\n\n${inviteLink}`);

      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("member");
      loadSettings();
    } catch (err) {
      console.error("Error inviting:", err);
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm("Are you sure you want to remove this member?")) return;

    const supabase = createClient();
    await supabase.from("organization_members").delete().eq("id", memberId);
    loadSettings();
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!confirm("Are you sure you want to revoke this invite?")) return;

    const supabase = createClient();
    await supabase.from("user_invites").delete().eq("id", inviteId);
    loadSettings();
  }

  async function handleChangeRole(memberId: string, newRole: string) {
    const supabase = createClient();
    await supabase
      .from("organization_members")
      .update({ role: newRole })
      .eq("id", memberId);
    loadSettings();
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 text-center">
        <p className="text-gray-400 mb-4">
          Sign in to view your organization settings
        </p>
        <a
          href="/login"
          className="inline-block px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
        >
          Sign In
        </a>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Settings</h1>

      {/* Organization settings */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">Organization</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Slug</label>
            <input
              type="text"
              value={org.slug}
              disabled
              className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 opacity-50"
            />
          </div>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">Team Members</h2>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition text-sm"
          >
            Invite Member
          </button>
        </div>

        {/* Owner */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between bg-gray-800/50 rounded px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{user?.email || user?.id}</span>
              <span className="px-2 py-0.5 bg-purple-900 text-purple-300 rounded text-xs">
                Owner
              </span>
            </div>
          </div>
        </div>

        {/* Members */}
        {members.length > 0 && (
          <div className="space-y-2 mb-4">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between bg-gray-800/50 rounded px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">{member.user_id}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      member.role === "admin"
                        ? "bg-blue-900 text-blue-300"
                        : "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {member.role}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={member.role}
                    onChange={(e) => handleChangeRole(member.id, e.target.value)}
                    className="text-xs px-2 py-1 bg-gray-700 rounded border-none focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <p className="text-sm text-gray-400 mb-2">Pending Invites</p>
            <div className="space-y-2">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between bg-gray-800/50 rounded px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{invite.email}</span>
                    <span className="px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded text-xs">
                      Pending
                    </span>
                    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs">
                      {invite.role}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(invite.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {members.length === 0 && invites.length === 0 && (
          <p className="text-sm text-gray-500">
            No team members yet. Invite someone to collaborate!
          </p>
        )}
      </div>

      {/* Subscription */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">Subscription</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Current Plan</span>
            <span className="font-medium">{tier?.name || "Free"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Status</span>
            <span
              className={`px-2 py-0.5 rounded text-sm ${
                org.subscription_status === "active"
                  ? "bg-green-900 text-green-300"
                  : "bg-yellow-900 text-yellow-300"
              }`}
            >
              {org.subscription_status}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Monthly Limit</span>
            <span>
              {tier?.monthly_token_limit?.toLocaleString() || "Unlimited"}{" "}
              requests
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Rate Limit</span>
            <span>{tier?.rate_limit_per_minute || 10} req/min</span>
          </div>
          <div className="pt-4 border-t border-gray-800">
            <a
              href="mailto:support@carintel.io?subject=Upgrade%20Request"
              className="text-purple-400 hover:text-purple-300 text-sm"
            >
              Contact us to upgrade your plan
            </a>
          </div>
        </div>
      </div>

      {/* Account info */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="font-semibold mb-4">Account</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Member Since</span>
            <span>{new Date(org.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Invite Team Member</h2>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="member">Member - Can view and use API keys</option>
                  <option value="admin">Admin - Can manage keys and members</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex-1 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {inviting ? "Sending..." : "Send Invite"}
              </button>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail("");
                  setInviteRole("member");
                }}
                className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
