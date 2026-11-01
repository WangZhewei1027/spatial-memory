# Repository Agent Guide

This repository contains the Spatial Memory web platform. The mini-program is a separate sibling repository; its public API contract is maintained here. Read [README.md](README.md) for local setup and [docs/README.md](docs/README.md) for the documentation index.

Before implementing or reviewing code, read [CODING_STANDARDS.md](CODING_STANDARDS.md). For check commands, test selection, Git hooks or CI changes, read [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture constraints

- The database connection has full privileges; enforce authorization in server code. Client capabilities and hidden controls are not security boundaries. Keep `server-only` modules out of client imports.
- Teams own assets and scenes. Workspaces are map collections with stable IDs, not independent permission scopes. Use the shared permission policies and content domain services for writes.
- Assets and scenes are mutable; saving a scene immediately affects playback and placements. Preserve optimistic locking and the single content model.
- Map selection and viewer messages identify placements, not their source assets. Preserve collection/QR identity and iframe-message contracts.
- Managed file deletion goes through `lib/storage/retention.server.ts`; upload receipts and object-key locks protect files still in use.
- Schema changes belong in `db/migrations/`; regenerate `lib/db/types.ts` after applying them to a development database. Production migrations are a separate operation from deployment.
- Edit source files, not `.next/`, `next-env.d.ts`, or `*.tsbuildinfo`.

## Read before changing a subsystem

| Change | Reference |
| --- | --- |
| UI, tokens, typography or shared components | [Design system](docs/design-system.md), [UI layers](docs/ui/architecture.md) |
| Database, authentication or permission checks | [Data layer](docs/data-layer.md), [Permissions](docs/permissions.md) |
| Team content, collections or content APIs | [Team workbench](docs/team-workbench.md), [Backend contract](docs/team-workbench-backend-contract.md) |
| Scene editing, document structure or playback | [Scene asset](docs/scene-asset.md), [Editor design](app/manage/scenes/DESIGN.md), [Scene Core](packages/scene-core/README.md) |
| Map editing or viewer messages | [Map interaction](docs/map-asset-interaction.md) |
| Uploads, file reuse or garbage collection | [Storage lifecycle](docs/asset-storage-lifecycle.md) |
| Mini-program API compatibility | [Mini-program API](docs/miniapp-api.md) |
| Deployment or production migrations | [Production deployment](docs/production-deployment.md), [Content migration runbook](docs/content-model-migration-runbook.md) |

For UI work, search existing components and reuse product patterns. Import Radix only through `components/ui/`, use semantic tokens and `Text`, and give icon-only controls accessible names. Preserve authentication, permission, route, API, database and iframe-message semantics during UI-system work. Check affected pages in both themes and both languages; update the design rules before introducing exceptions.

## Validation

- After code changes, run `npm run check` (typecheck, lint, offline behavior tests and build), plus the affected integration or cross-runtime tests described in `CONTRIBUTING.md`.
- Default checks need no live database or sibling checkout. Inspect integration tests' database and fixture requirements before executing them; the default suite does not validate database upgrades or cross-runtime playback.
- Standalone TypeScript scripts importing `lib/db` or server auth modules require `npx tsx --conditions react-server`.

## Agent skills

### Issue tracker

Track requirements, specs, and implementation tickets in `WangZhewei1027/spatial-memory` GitHub Issues. Before reading, publishing, or updating tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels. Before classifying issues or changing their triage state, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` and `docs/adr/`. Before exploring domain terminology or proposing architectural changes, read `docs/agents/domain.md`.
