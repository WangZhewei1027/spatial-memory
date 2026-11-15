/**
 * Two-tier permission system configuration
 *
 * Tier 1: Global role (users.role)
 *   - super_admin: Full system access, can CRUD organizations, manage user roles
 *   - user: Normal user, controlled by Tier 2 org roles
 *
 * Tier 2: Organization (team) role (organization_member.role) — the only
 * content permission boundary. Every member reads all team content.
 *   - owner: Full org control (settings, members, ownership, delete) + content
 *   - admin: Manage members (except owners) + content
 *   - member: Create, edit, version, archive team content and map collections
 *   - viewer: Read-only
 */

// --- Tier 1: Global roles ---
export type GlobalRole = "super_admin" | "user";

// --- Tier 2: Organization roles ---
export type OrgRole = "owner" | "admin" | "member" | "viewer";

// --- Permission keys ---
export type OrgPermission =
  | "org.view"
  | "org.settings"
  | "org.delete"
  | "org.members.view"
  | "org.members.add"
  | "org.members.remove"
  | "org.members.changeRole"
  | "org.members.manageOwners"
  | "org.workspaces.view"
  | "org.workspaces.create"
  | "org.workspaces.edit"
  | "org.workspaces.delete"
  | "org.assets.write"
  | "org.collections.manage";

export type GlobalPermission =
  | "global.users.view"
  | "global.users.changeRole"
  | "global.organizations.create"
  | "global.organizations.viewAll";

// --- Permission matrix for org roles ---
const ORG_PERMISSION_MATRIX: Record<OrgRole, OrgPermission[]> = {
  owner: [
    "org.view",
    "org.settings",
    "org.delete",
    "org.members.view",
    "org.members.add",
    "org.members.remove",
    "org.members.changeRole",
    "org.members.manageOwners",
    "org.workspaces.view",
    "org.workspaces.create",
    "org.workspaces.edit",
    "org.workspaces.delete",
    "org.assets.write",
    "org.collections.manage",
  ],
  admin: [
    "org.view",
    "org.members.view",
    "org.members.add",
    "org.members.remove",
    "org.members.changeRole",
    "org.workspaces.view",
    "org.workspaces.create",
    "org.workspaces.edit",
    "org.workspaces.delete",
    "org.assets.write",
    "org.collections.manage",
  ],
  member: [
    "org.view",
    "org.members.view",
    "org.workspaces.view",
    "org.assets.write",
    "org.collections.manage",
  ],
  viewer: ["org.view", "org.workspaces.view"],
};

// --- Permission matrix for global roles ---
const GLOBAL_PERMISSION_MATRIX: Record<GlobalRole, GlobalPermission[]> = {
  super_admin: [
    "global.users.view",
    "global.users.changeRole",
    "global.organizations.create",
    "global.organizations.viewAll",
  ],
  user: [],
};

// --- Helper functions ---

/** Check if a global role has a specific global permission */
export function hasGlobalPermission(
  globalRole: string | undefined | null,
  permission: GlobalPermission,
): boolean {
  if (!globalRole) return false;
  const perms = GLOBAL_PERMISSION_MATRIX[globalRole as GlobalRole];
  return perms?.includes(permission) ?? false;
}

/** Check if an org role has a specific org permission */
export function hasOrgPermission(
  orgRole: string | undefined | null,
  permission: OrgPermission,
): boolean {
  if (!orgRole) return false;
  const perms = ORG_PERMISSION_MATRIX[orgRole as OrgRole];
  return perms?.includes(permission) ?? false;
}

/** Check if user is super_admin */
export function isSuperAdmin(globalRole: string | undefined | null): boolean {
  return globalRole === "super_admin";
}

/**
 * Sidebar visibility config: which sidebar items are visible to which roles.
 * super_admin always sees everything.
 */
export const SIDEBAR_VISIBILITY: Record<
  string,
  {
    requireGlobal?: GlobalPermission;
    requireOrg?: OrgPermission;
  }
> = {
  "/admin": { requireOrg: "org.view" },
  "/admin/settings": { requireOrg: "org.settings" },
  "/admin/members": { requireOrg: "org.members.view" },
};

/** Check if a sidebar item should be visible */
export function isSidebarItemVisible(
  href: string,
  globalRole: string | undefined | null,
  orgRole: string | undefined | null,
): boolean {
  // super_admin always sees everything
  if (isSuperAdmin(globalRole)) return true;

  const config = SIDEBAR_VISIBILITY[href];
  if (!config) return true;

  // If requires global permission, check it
  if (config.requireGlobal) {
    return hasGlobalPermission(globalRole, config.requireGlobal);
  }

  // If requires org permission, check it
  if (config.requireOrg) {
    return hasOrgPermission(orgRole, config.requireOrg);
  }

  return true;
}

/** Team roles allowed to write content; viewers only read. */
export function orgRoleCanWrite(orgRole: string | null | undefined): boolean {
  return orgRole === "owner" || orgRole === "admin" || orgRole === "member";
}
