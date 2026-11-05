import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { loadEnvFile, requireEnv } from "./lib/env";
import { isUuid } from "../lib/content-model/input";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false },
    "regenerate-models": { type: "boolean", default: false },
    "env-file": { type: "string" },
    "asset-id": { type: "string" },
    "organization-id": { type: "string" },
    limit: { type: "string" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("node --import tsx --conditions react-server scripts/backfill-asset-thumbnails.ts [--env-file PATH] [--asset-id UUID] [--organization-id UUID] [--limit N] [--regenerate-models] [--apply]\nDefaults to read-only inventory of missing covers. --regenerate-models selects existing system-generated model covers. Without --env-file, use explicit environment variables.");
    return;
  }
  if (values["env-file"]) {
    if (!existsSync(values["env-file"])) throw new Error("The selected environment file does not exist");
    loadEnvFile(values["env-file"]);
  }
  requireEnv("DATABASE_URL");
  for (const key of ["asset-id", "organization-id"] as const) if (values[key] && !isUuid(values[key])) throw new Error(`${key} must be a UUID`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error("limit must be a positive integer");
  // Import after environment selection: media URLs are initialized on module load.
  const { db } = await import("../lib/db");
  const { ContentError } = await import("../lib/content-model/errors");
  try {
    const { listAssetThumbnailCandidates, backfillAssetThumbnail } = await import("../lib/assets/thumbnail-backfill.server");
    const candidates = await listAssetThumbnailCandidates({ assetId: values["asset-id"], organizationId: values["organization-id"],
      regenerateModels: values["regenerate-models"], limit });
    const stats = { mode: values.apply ? "apply" : "dry-run", operation: values["regenerate-models"] ? "regenerate-models" : "backfill",
      candidates: candidates.length, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
    for (const candidate of candidates) {
      const identity = { assetId: candidate.id, type: candidate.type, organizationId: candidate.organizationId, state: candidate.state,
        ...(candidate.previousThumbnail ? { primaryStorageKey: candidate.storageKey, previousThumbnail: candidate.previousThumbnail } : {}) };
      if (!values.apply) {
        console.log(JSON.stringify({ ...identity, status: "candidate", source: candidate.storageKey ? "managed" : candidate.externalUrl ? "external" : "missing",
          ...(candidate.organizationArchived ? { reason: "organization_archived" } : {}) }));
        continue;
      }
      try {
        const result = await backfillAssetThumbnail(candidate);
        stats[result.status]++;
        console.log(JSON.stringify({ ...identity, ...result }));
      } catch (error) {
        stats.failed++;
        // Storage/network exceptions can contain signed URLs; never print raw SDK errors.
        console.error(JSON.stringify({ ...identity, status: "failed", code: error instanceof ContentError ? error.code : "BACKFILL_FAILED",
          message: error instanceof ContentError ? error.message : "Unable to read, render or save this asset; check runtime/storage configuration and retry." }));
      }
    }
    console.log(JSON.stringify(stats));
    // A partial run is explicit and safe to resume; success means all candidates were attached.
    if (values.apply && (stats.failed || stats.skipped)) process.exitCode = 2;
  } finally { await db.destroy(); }
}

main().catch(() => {
  console.error("Thumbnail backfill could not start or finish. Check the selected environment, arguments and database migrations; no credentials are printed.");
  process.exitCode = 1;
});
