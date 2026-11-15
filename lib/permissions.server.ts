import "server-only";
import { db } from "@/lib/db";

/**
 * Fetch the caller's global role (users.role) and, if an org is given, their
 * membership role in that org (organization_member.role). Shared by every API
 * route that gates on roles so the lookup logic lives in one place.
 */
export async function getUserContext(
  userId: string,
  orgId?: string | null,
): Promise<{ globalRole: string | null; orgRole: string | null }> {
  const userPromise = db
    .selectFrom("users")
    .select("role")
    .where("user_id", "=", userId)
    .executeTakeFirst();

  const membershipPromise = orgId
    ? db
        .selectFrom("organization_member")
        .select("role")
        .where("organization_id", "=", orgId)
        .where("user_id", "=", userId)
        .executeTakeFirst()
    : Promise.resolve(undefined);

  const [userData, membership] = await Promise.all([
    userPromise,
    membershipPromise,
  ]);

  return {
    globalRole: userData?.role ?? null,
    orgRole: membership?.role ?? null,
  };
}

/** Resolve the organization a workspace belongs to (null if not found). */
export async function getWorkspaceOrgId(
  workspaceId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom("workspace")
    .select("organization_id")
    .where("id", "=", workspaceId)
    .executeTakeFirst();
  return row?.organization_id ?? null;
}
