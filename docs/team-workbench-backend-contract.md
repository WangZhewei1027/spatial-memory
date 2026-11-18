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
| `POST /api/content/duplicate` | Super-admin copy of authored content and its dependency closure into another team |
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

## Cross-team duplication

`POST /api/content/duplicate` accepts `{ sourceType, sourceId, targetOrganizationId, targetWorkspaceId?, name?, idempotencyKey }`. `sourceType` is `asset`, `scene`, `activity`, `collection` or `placement`; anchors use `asset`. Only the server-resolved global `super_admin` may call it, including when an ordinary user can write to both teams. Placements require an open target collection in the selected team. The source team, target team, root content and copied dependencies must be unarchived; restore archived content before copying it. Existing same-team copy and ordinary resource-reuse APIs keep their current permission rules.

The result is `{ data: { id, sourceType, organizationId, created } }`, with HTTP 201 for a new copy and 200 for an idempotent replay. The idempotency scope includes the source, destination and name; using the same key with different inputs returns 409. One transaction creates the entire dependency graph or rolls it back. Copies have new IDs, initial concurrency counters and target-team ownership. Each source entity is copied once within that operation, so repeated scene aliases and placements share the corresponding new entity.

- Assets copy payload and all file roles/ordinals and metadata. Managed physical files are reused under the retention locks; source edits cannot change the copied asset or release its files. External URLs continue to refer to the external provider.
- Scenes copy their saved document, duplicate every referenced asset, rewrite all asset aliases and rebuild `scene_asset_ref` in the target team.
- Activities copy their definition, points and image/reward assets. Standalone copies have no map association or participation records.
- Collections copy map settings, tags, non-archived content placements, non-archived activity associations and their dependencies. Ordinary placement states and anchor bindings are preserved; new activity associations start paused and refer to new activities.
- Standalone placements copy their target content, tags and recognition dependency, including an active anchor placement in the destination map when required.

Organization memberships, participant history, upload receipts, old audits and derived recognition caches are not copied. The operation writes its own audit entry. No schema migration or mini-program protocol change is required.

## Official templates

Migration `20261118000000_official_templates.sql` creates a new team named 官方模板库. Each database has its own ID. A unique index limits `organization.is_official_template_library` to one true row. Team lists and details expose this field so maintainers can identify the library after a rename. A super-admin can manage the new team and add maintainers through the usual team APIs. Existing teams keep their memberships, management permissions and mini-program behavior.

| Endpoint | Contract |
| --- | --- |
| `GET /api/templates` | Public paged list of active assets, scenes and open maps in the open official team. Optional `type=asset\|scene\|collection`, literal name search `q`, `limit` (1–200, default 30), and `offset`. Returns `{ data: [{ id, type, name, thumbnail }], page: { limit, offset, hasMore } }`. |
| `POST /api/upload` | Send multipart fields `file`, `organization_id` and `template_preview=true` as an official team writer. Upload a static image, animated GIF/WebP or video. Animated GIF/WebP retains motion as WebP, video uses the existing MP4 pipeline. Use the returned primary `data.id` as the receipt. |
| `GET /api/templates/[type]/[id]/preview` | Official team readers can retrieve the manually assigned cover as `{ data: { thumbnail, lock_version } }`. The initial state is `null` and version 0. |
| `PUT /api/templates/[type]/[id]/preview` | Official team writers submit `{ receiptId, expectedLockVersion }` to replace the manual cover. Supply `receiptId: null` to clear it. Returns the updated manual cover and version. Archived teams and resources are read-only. A missing version returns 428 and a stale version returns 409. |
| `POST /api/templates/duplicate` | Signed-in writers may copy a catalog item to another open team they can edit. Accepts `{ sourceType, sourceId, targetOrganizationId, idempotencyKey, name?, targetWorkspaceId? }`. The three accepted source types match the catalog. Status 201 on creation, 200 on replay, with the same result shape as the admin copy endpoint. |

A thumbnail is `{ kind: "image" | "video", url }` or `null`. The catalog prioritizes the manual cover. Assets can fall back to an existing thumbnail resource. Scenes and maps without a manual cover return `null`. The manual cover has its own concurrency counter and file retention. Saving it leaves the scene document, map settings and normal playback alone.

Template copies use the [cross-team duplication](#cross-team-duplication) rules, including new team-owned dependencies and fresh IDs. A map template includes draft and paused content placements as well as active ones. Copied activity links start paused. Template display media stays with the official item. The destination uses its ordinary team editors. QR playback and map discovery continue to use the existing mini-program contracts in both teams.

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

Teams own independent `shop_checkin` and `danmaku` activities. A shop check-in activity contains multiple points with fixed locations. An activity has at most one non-archived map association. Active and paused links both occupy that slot; only unlinking (`archived`) releases it. New links default to paused; draft is no longer accepted. Legacy multi-map associations remain readable so owners can resolve migration conflicts; old drafts display as paused, while writes reject draft. Activity DTOs include `has_map_link` (false when unlinked). Placements contain only map association and status; they do not own point locations, rule overrides or point enablement. Point images and reward images reference ordinary image Assets, appear in asset usage, and keep existing storage retention semantics.

Danmaku `config.maxLength` defaults to 50 for new activities and configurations without an explicit valid limit. The editor, effective configuration and public submission validation share `DEFAULT_DANMAKU_MAX_LENGTH` from `lib/activities/defaults.ts`. Explicit integer limits from 1 through 500 remain valid and are preserved; 500 is the configuration ceiling, not the default. Public activity responses expose the effective limit, and submission validation enforces that activity's limit.

| Route | Behavior |
| --- | --- |
| `GET/POST /api/organizations/[id]/activities` | List/create team activities; POST optionally accepts `workspaceId` to create an initial paused map association atomically |
| `GET/PATCH /api/activities/[id]` | Edit shared rules, name, state, geographic scope (`location`, `radiusMeters`) and points including fixed `location`; points omitted from a submitted complete list are archived |
| `GET/POST /api/activities/[id]/placements` | List/create map associations with map, status and idempotency key |
| `GET/PATCH /api/activity-placements/[id]` | Read/update association status; activity and map identity cannot be changed; location, radius, config and point fields are rejected |
| `GET /api/collections/[id]/activity-placements` | Map activity placements, separate from content placements |
| `GET /api/activities/[id]/records` | Paginated records, optionally filtered by `placementId`; `limit` ≤ 200 |
| `PATCH /api/activity-records/[id]` | Hide or restore a record with optimistic locking |

Activity creation without `workspaceId` remains independent of maps. With `workspaceId`, `lib/activities/service.server.ts` checks team write permission and an editable, unarchived map in the same organization, then creates the activity and paused association in one transaction. Failure leaves neither new row. The existing creation `idempotencyKey` covers the whole request, including the map: matching retries reuse the activity, changed requests conflict, and replay does not restore a subsequently removed association. This uses the existing schema; no migration is required.

Creating a link or restoring an archived link while another map is linked returns `DEPENDENCY_CONFLICT` (409). Writes serialize on an activity-wide lock, backed by a partial unique index on non-archived placements. The activity/map pair remains unique so relinking restores its original placement ID and history. Activity and map must belong to the same team; associations cannot move between teams.

Responses and errors use the shared envelopes. Activity, placement and record writes require `expectedLockVersion`; creates accept `idempotencyKey`. The client-safe contracts are in `lib/activities/contracts.ts`. Team writers manage activities and records, viewers read only. Activity placement writes also require an open map; archived teams block all writes. Archiving an activity stops public discovery and participation in all its placements. Archiving points and hiding records preserve history.

Activity records retain activity, placement and (for check-ins) point identity. They never create ordinary Assets or content Placements. Progress and public messages are scoped to the individual placement; shared activity definitions do not merge participation data. Device participant IDs are self-asserted, not authenticated users. Public participation and retrieval are documented in [Mini-program API](miniapp-api.md).

The former shop Asset type and old shop/text submission endpoints are removed. Historical conversion, explicit text classification and coordinated release steps are in the [activity migration runbook](activity-migration-runbook.md).
