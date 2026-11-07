import "server-only";

import { db, sql } from "@/lib/db";
import { requireOrgRead, type Actor } from "@/lib/content-model/access.server";
import { ContentError, forbidden, notFound } from "@/lib/content-model/errors";
import { requireUuid, type JsonRecord } from "@/lib/content-model/input";

// A global, super-admin-owned allowlist. Never read this from organization.config:
// that configuration is editable by organization owners.
const CONFIG_KEY = "map_scan_model_organizations";

function requireSuperAdmin(actor: Actor) {
  if (!actor.superAdmin) throw forbidden();
}

export async function listMapScanModelOrganizations(actor: Actor) {
  requireSuperAdmin(actor);
  return db
    .selectFrom("organization as o")
    .leftJoin("app_config as c", (join) => join.on("c.key", "=", CONFIG_KEY))
    .select(["o.id", "o.name", "o.archived_at"])
    .select(sql<boolean>`coalesce(c.value -> o.id::text = 'true'::jsonb, false)`.as("enabled"))
    .orderBy("o.name")
    .orderBy("o.id")
    .execute();
}

export async function getMapScanModelSetting(actor: Actor, organizationId: string) {
  const access = await requireOrgRead(db, actor, organizationId);
  if (access.org.archived_at) return { enabled: false };
  const config = await db.selectFrom("app_config")
    .select(sql<boolean>`coalesce(value -> ${organizationId} = 'true'::jsonb, false)`.as("enabled"))
    .where("key", "=", CONFIG_KEY).executeTakeFirst();
  return { enabled: config?.enabled === true };
}

export async function updateMapScanModelSetting(actor: Actor, input: JsonRecord) {
  requireSuperAdmin(actor);
  const organizationId = requireUuid(input.organizationId, "organizationId");
  if (typeof input.enabled !== "boolean") throw new ContentError("VALIDATION_FAILED", "enabled 必须是布尔值");
  const enabled = input.enabled;

  return db.transaction().execute(async (trx) => {
    const organization = await trx.selectFrom("organization").select("id")
      .where("id", "=", organizationId).forShare().executeTakeFirst();
    if (!organization) throw notFound("组织不存在");

    // Merge only this organization's entry in SQL, preserving concurrent changes
    // to other organizations. Missing entries (including every new team) are off.
    const entry = JSON.stringify({ [organizationId]: enabled });
    await trx.insertInto("app_config")
      .values({ key: CONFIG_KEY, value: entry })
      .onConflict((oc) => oc.column("key").doUpdateSet({
        value: sql`app_config.value || ${entry}::jsonb`,
        updated_at: new Date(),
      }))
      .execute();
    return { organizationId, enabled };
  });
}
