"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAdmin, canManage } from "@/components/AdminProvider";
import { useAuth } from "@/components/AuthProvider";

interface UserWithOrgs {
  user_id: string;
  email?: string;
  organizations: {
    id: string;
    name: string;
    role: string;
    is_owner: boolean;
  }[];
  last_sign_in?: string;
}

interface Organization {
  id: string;
  name: string;
}

export default function UsersAdminPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isAdmin, adminRole, loading: adminLoading } = useAdmin();
  const [users, setUsers] = useState<UserWithOrgs[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal states
  const [selectedUser, setSelectedUser] = useState<UserWithOrgs | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [selectedOrgForAction, setSelectedOrgForAction] = useState<string>("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (adminLoading) return;

    if (!isAdmin) {
      router.push("/");
      return;
    }

    loadData();
  }, [isAdmin, adminLoading, router]);

  async function loadData() {
    try {
      const supabase = createClient();

      // Load organizations
      const { data: orgsData } = await supabase
        .from("organizations")
        .select("id, name, owner_user_id")
        .order("name");

      setOrganizations(orgsData || []);

      // Load organization members with their orgs
      const { data: membersData } = await supabase
        .from("organization_members")
        .select(`
          user_id,
          role,
          organization_id,
          organizations (id, name, owner_user_id)
        `);

      // Also load org owners who might not be in organization_members
      const ownerUserIds = orgsData?.map((org) => org.owner_user_id).filter(Boolean) || [];

      // Group by user
      const userMap = new Map<string, UserWithOrgs>();

      // Add owners first
      orgsData?.forEach((org) => {
        if (org.owner_user_id) {
          if (!userMap.has(org.owner_user_id)) {
            userMap.set(org.owner_user_id, {
              user_id: org.owner_user_id,
              organizations: [],
            });
          }
          const userData = userMap.get(org.owner_user_id)!;
          if (!userData.organizations.find((o) => o.id === org.id)) {
            userData.organizations.push({
              id: org.id,
              name: org.name,
              role: "owner",
              is_owner: true,
            });
          }
        }
      });

      // Add members
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      membersData?.forEach((member: any) => {
        const org = member.organizations as { id: string; name: string; owner_user_id: string } | null;
        if (!org) return;

        if (!userMap.has(member.user_id)) {
          userMap.set(member.user_id, {
            user_id: member.user_id,
            organizations: [],
          });
        }

        const userData = userMap.get(member.user_id)!;
        const isOwner = org.owner_user_id === member.user_id;

        // Don't duplicate if already added as owner
        if (!userData.organizations.find((o) => o.id === org.id)) {
          userData.organizations.push({
            id: org.id,
            name: org.name,
            role: isOwner ? "owner" : member.role,
            is_owner: isOwner,
          });
        }
      });

      setUsers(Array.from(userMap.values()));
    } catch (err) {
      console.error("Error loading users:", err);
    } finally {
      setLoading(false);
    }
  }

  async function logAdminAction(action: string, targetId: string, details: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("admin_audit_log").insert({
      admin_user_id: user?.id,
      action,
      target_type: "user",
      target_id: targetId,
      details,
    });
  }

  async function handleAddToOrg() {
    if (!selectedUser || !inviteOrgId || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", inviteOrgId)
        .eq("user_id", selectedUser.user_id)
        .maybeSingle();

      if (existing) {
        alert("User is already a member of this organization");
        setActionLoading(false);
        return;
      }

      await supabase.from("organization_members").insert({
        organization_id: inviteOrgId,
        user_id: selectedUser.user_id,
        role: inviteRole,
        invited_by: user?.id,
      });

      await logAdminAction("add_user_to_org", selectedUser.user_id, {
        organization_id: inviteOrgId,
        role: inviteRole,
      });

      setShowInviteModal(false);
      setInviteOrgId("");
      setInviteRole("member");
      loadData();
    } catch (err) {
      console.error("Error adding user to org:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemoveFromOrg() {
    if (!selectedUser || !selectedOrgForAction || !canManage(adminRole)) return;

    setActionLoading(true);
    try {
      const supabase = createClient();

      await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", selectedOrgForAction)
        .eq("user_id", selectedUser.user_id);

      await logAdminAction("remove_user_from_org", selectedUser.user_id, {
        organization_id: selectedOrgForAction,
      });

      setShowRemoveModal(false);
      setSelectedOrgForAction("");
      loadData();
    } catch (err) {
      console.error("Error removing user from org:", err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangeRole(userId: string, orgId: string, newRole: string) {
    if (!canManage(adminRole)) return;

    try {
      const supabase = createClient();

      await supabase
        .from("organization_members")
        .update({ role: newRole })
        .eq("organization_id", orgId)
        .eq("user_id", userId);

      await logAdminAction("change_user_role", userId, {
        organization_id: orgId,
        new_role: newRole,
      });

      loadData();
    } catch (err) {
      console.error("Error changing role:", err);
    }
  }

  const filteredUsers = users.filter((u) => {
    const searchLower = search.toLowerCase();
    return (
      u.user_id.toLowerCase().includes(searchLower) ||
      u.email?.toLowerCase().includes(searchLower) ||
      u.organizations.some((o) => o.name.toLowerCase().includes(searchLower))
    );
  });

  if (adminLoading || loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Users</h1>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by user ID, email, or organization..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
        />
      </div>

      {/* Users list */}
      <div className="space-y-4">
        {filteredUsers.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-400">
            No users found
          </div>
        ) : (
          filteredUsers.map((userData) => (
            <div key={userData.user_id} className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium font-mono text-sm">{userData.user_id}</p>
                  {userData.email && (
                    <p className="text-gray-400 text-sm">{userData.email}</p>
                  )}
                </div>
                {canManage(adminRole) && (
                  <button
                    onClick={() => {
                      setSelectedUser(userData);
                      setShowInviteModal(true);
                    }}
                    className="px-3 py-1 text-sm text-purple-400 hover:text-purple-300 hover:bg-purple-900/30 rounded transition"
                  >
                    Add to Organization
                  </button>
                )}
              </div>

              {userData.organizations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className="text-xs text-gray-500 mb-2">Organizations</p>
                  <div className="space-y-2">
                    {userData.organizations.map((org) => (
                      <div
                        key={org.id}
                        className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span>{org.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              org.is_owner
                                ? "bg-purple-900 text-purple-300"
                                : org.role === "admin"
                                  ? "bg-blue-900 text-blue-300"
                                  : "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {org.is_owner ? "Owner" : org.role}
                          </span>
                        </div>
                        {canManage(adminRole) && !org.is_owner && (
                          <div className="flex items-center gap-2">
                            <select
                              value={org.role}
                              onChange={(e) =>
                                handleChangeRole(userData.user_id, org.id, e.target.value)
                              }
                              className="text-xs px-2 py-1 bg-gray-700 rounded border-none focus:outline-none focus:ring-1 focus:ring-purple-500"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button
                              onClick={() => {
                                setSelectedUser(userData);
                                setSelectedOrgForAction(org.id);
                                setShowRemoveModal(true);
                              }}
                              className="text-xs text-red-400 hover:text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add to Org Modal */}
      {showInviteModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Add User to Organization</h2>
            <p className="text-gray-400 text-sm mb-4">
              Add user <span className="font-mono text-xs">{selectedUser.user_id}</span> to an
              organization.
            </p>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Organization</label>
                <select
                  value={inviteOrgId}
                  onChange={(e) => setInviteOrgId(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Select organization...</option>
                  {organizations
                    .filter(
                      (org) =>
                        !selectedUser.organizations.find((o) => o.id === org.id)
                    )
                    .map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                  className="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddToOrg}
                disabled={actionLoading || !inviteOrgId}
                className="flex-1 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Adding..." : "Add to Organization"}
              </button>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteOrgId("");
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

      {/* Remove from Org Modal */}
      {showRemoveModal && selectedUser && selectedOrgForAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Remove User from Organization</h2>
            <p className="text-gray-400 text-sm mb-4">
              Are you sure you want to remove this user from{" "}
              <strong>
                {
                  selectedUser.organizations.find((o) => o.id === selectedOrgForAction)
                    ?.name
                }
              </strong>
              ?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleRemoveFromOrg}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-red-600 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {actionLoading ? "Removing..." : "Remove User"}
              </button>
              <button
                onClick={() => {
                  setShowRemoveModal(false);
                  setSelectedOrgForAction("");
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
