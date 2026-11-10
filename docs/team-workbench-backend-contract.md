# Team workbench backend contract

The application has one content model. Organizations are teams; existing workspace rows are map collections. Runtime queries and writes use Asset, Scene, Placement and the independent Activity model. Migration-only source formats live under `scripts/migrate/content-model/` and `migration_archive`, outside runtime services.

## Ownership and permissions

Every team member reads the team's assets, scenes and collections. Owners, admins and members can create and edit content; viewers only read. Ownership transfer and team administration remain owner/admin operations. A new team starts with zero collections. Assets and scenes can be created before any map exists.

A collection owns content placements, activity placements and tags, not assets, scenes, activities or members. Archiving it stops its public discovery and placement edits without changing team content. The organization archive blocks all content writes. Collection IDs remain the former workspace UUIDs so QR codes continue to identify the same collection.

Asset visibility, maintainer and origin collection are metadata, not permission boundaries. Workspace assignments, asset grants, shared scopes, model-state gates and model-version request headers are removed.

## Routes

| Route | Behavior |
| --- | --- |
| `GET/POST /api/organizations/[id]/assets` | List/create team assets, no collection required |
| `GET /api/collections/[id]/assets` | Team catalog with usability capabilities for this collection |
| `GET/PATCH/DELETE /api/assets/[id]` | Read, edit identity/content, archive; anchors use the same model |
| `GET /api/assets/[id]/usage` | Team-visible scene, placement and activity-point dependencies |
| `POST /api/assets/[id]/duplicate` | Create a team-owned copy |
| `GET/POST /api/organizations/[id]/scenes` | List/create independent team scenes |
| `POST /api/organizations/[id]/scenes/validate` | Read-only preflight of write permission, resource ownership/type, animations and optional scene lock version |
| `POST /api/scenes/[id]/copy` | Copy saved content into an independent team scene |
| `GET/PATCH /api/scenes/[id]` | Read/save schema-6 scene with direct asset references |
| `GET/POST /api/organizations/[id]/collections` | List/create collections |
| `GET/PATCH /api/collections/[id]` | Read/rename collection or update its mini-program settings |
| `POST/DELETE /api/collections/[id]/archive` | Archive/restore collection |
| `GET/POST /api/collections/[id]/placements` | List/create independently editable placements; upload-and-place is atomic |
| `GET/PATCH/DELETE /api/placements/[id]` | Read/edit/archive a placement |
| `POST /api/placements/move` | Atomically move placements with per-item lock versions |
| `POST /api/placements/[id]/copy` | Create an independent placement in an authorized collection |
| `GET /api/placements/[id]/content` | Current asset content or current scene with current asset files |
| `POST /api/upload` | Upload with explicit team/collection and an actor-bound receipt |
| `GET/POST /api/assets/[id]/matching` | Read/build reference features for the current anchor image |

Old `/api/workspaces/*`, workspace grants/members, asset move/copy adapters and content-model activation endpoints do not exist. Responses are `{ data }` (paged lists add `page`); errors are `{ error, code, details? }`. `lib/content-model/contracts.ts` is the typed contract.

The scene, activity and collection catalogs accept optional `limit` (1–200) and `offset` (0–1000000). Supplying either requests a page with `{ data, page: { limit, offset, hasMore } }`. Omitting both returns the complete filtered `{ data }` list for existing pickers. State and literal case-insensitive name search (`q`) apply before pagination. The asset catalog retains its existing total-count page contract.

## Consistency

Asset/scene/placement writes require `expectedLockVersion` (428 if missing, 409 if stale). It is a concurrency counter, not an asset content version. Asset PATCH accepts `payload` and `resources` together, replacing both atomically. Creation supports idempotency keys. Scene saves take effect immediately.

Collection DTOs include `miniapp_config` and `config_lock_version`. Updating settings submits the complete four-field `miniappConfig` with `expectedLockVersion` equal to that configuration counter (428 if missing, 409 if stale). A team writer may edit an open map; archived teams/maps and viewers cannot write. The transaction locks the team and map, validates the version, saves settings and increments the counter. Rename/description-only updates leave settings and their counter unchanged. Settings never inherit subsequent team changes; defaults, migration and the public whitelist are documented in [mini-program API](miniapp-api.md#每个地图合集的小程序设置).

Placements target `{kind:"asset", assetId}` or `{kind:"scene", sceneId}`. Scene resource aliases use `{assetId}` in schema 6; playback compiles to schema 4/5 for model scenes, 7 for presentation/media, 8 for opacity/volume automation or spatial audio, 9 for an explicit viewer position, and 10 for explicit scene lighting (see [scene-asset.md](scene-asset.md)). All asset references resolve current content, including every saved scene; asset edits require no placement upgrade or scene publication. Public discovery reads active placements in open teams and collections, with stable placement IDs.

Managed resources come from receipts or authorized `fromAssetId` sources. Receipt purpose is `asset`. Retention checks current resources, live receipts, reference features, derived audio and migration holds. Anchor features use the asset ID; changing its reference image invalidates existing and in-flight descriptors.

The management client refreshes resources after successful mutations, across same-origin tabs and on focus. Scene resource refresh preserves unsaved composition changes and undo history. External clients see edits on their next content fetch.

## Migration and validation

See [content-model-migration-runbook.md](content-model-migration-runbook.md). The SQL baseline describes the final schema; upgrades convert data and remove old tables/columns in one transaction. `migration_archive` retains evidence without serving application reads.

Focused checks: `test-single-content-model-migration.ts`, `test-mutable-assets-migration.ts`, `test-content-model-services.ts`, `test-team-workbench-routes.ts`, `test-content-model-contracts.ts`, `test-scene-add-model.ts`. UI checks are typecheck, lint and production build.

## Activities

Teams own independent `shop_checkin` and `danmaku` activities. A shop check-in activity contains multiple points with fixed locations. Activity rules and geographic scope are shared by all map associations. Placements contain only map association and status; they do not own point locations, rule overrides or point enablement. Point images and reward images reference ordinary image Assets, appear in asset usage, and keep existing storage retention semantics.

| Route | Behavior |
| --- | --- |
| `GET/POST /api/organizations/[id]/activities` | List/create team activities without selecting a map |
| `GET/PATCH /api/activities/[id]` | Edit shared rules, name, state, geographic scope (`location`, `radiusMeters`) and points including fixed `location`; points omitted from a submitted complete list are archived |
| `GET/POST /api/activities/[id]/placements` | List/create map associations with map, status and idempotency key |
| `GET/PATCH /api/activity-placements/[id]` | Read/update association status; activity and map identity cannot be changed; location, radius, config and point fields are rejected |
| `GET /api/collections/[id]/activity-placements` | Map activity placements, separate from content placements |
| `GET /api/activities/[id]/records` | Paginated records, optionally filtered by `placementId`; `limit` ≤ 200 |
| `PATCH /api/activity-records/[id]` | Hide or restore a record with optimistic locking |

Responses and errors use the shared envelopes. Activity, placement and record writes require `expectedLockVersion`; creates accept `idempotencyKey`. The client-safe contracts are in `lib/activities/contracts.ts`. Team writers manage activities and records, viewers read only. Activity placement writes also require an open map; archived teams block all writes. Archiving an activity stops public discovery and participation in all its placements. Archiving points and hiding records preserve history.

Activity records retain activity, placement and (for check-ins) point identity. They never create ordinary Assets or content Placements. Progress and public messages are scoped to the individual placement; shared activity definitions do not merge participation data. Device participant IDs are self-asserted, not authenticated users. Public participation and retrieval are documented in [Mini-program API](miniapp-api.md).

The former shop Asset type and old shop/text submission endpoints are removed. Historical conversion, explicit text classification and coordinated release steps are in the [activity migration runbook](activity-migration-runbook.md).
