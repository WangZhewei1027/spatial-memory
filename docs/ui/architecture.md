# UI Architecture

The repository uses one UI system: the tokens in `app/globals.css` and `tailwind.config.ts`, the primitives in `components/ui/`, and the rules in `docs/design-system.md`.

## Layers

1. **Foundation** — CSS variables, font loading, Tailwind scales, breakpoints, radius and semantic color. Sources: `app/globals.css`, `tailwind.config.ts`, `lib/fonts.ts`.
2. **Component** — reusable, business-neutral primitives in `components/ui/` and route-neutral shared components in `components/`.
3. **Pattern** — recurring product compositions with a stable purpose, kept near their shared consumers.
4. **Feature** — business-aware UI, hooks and state under `app/<route>/components` and related feature folders.
5. **Page** — routing, data access, permission checks, server/client boundaries, analytics and feature composition under `app/`.

Pages and containers own API calls, authorization decisions, navigation semantics and orchestration. A presentational child should receive data and callbacks through props when that keeps its production API honest.

## Choosing an abstraction

Use an existing `components/ui` primitive directly when its API and appearance already match the product need. Add a product wrapper only when several consumers repeat a meaningful product contract, not to rename Radix or Tailwind props. Search existing components before creating anything new.

Do not import Radix directly outside `components/ui/`. Follow the typography and semantic-token rules in `docs/design-system.md`.

## Navigation

- `components/ui/navigation-island.tsx` owns only the shared navigation surface; its radius, shadow and row/gutter tokens live in `app/globals.css`.
- `components/navbar.tsx` composes the global header, breadcrumbs and account controls. Collection, scene and activity editors own their full-window headers and reuse the same surface. `app/manage/content/EditorHeaderBar.tsx` composes the return link, document identity, status and actions for collection and activity headers; `CollectionHeaderBar` supplies the map-specific content.
- `components/console-navigation.tsx` composes the desktop island and labeled mobile drawer for team, admin and super-admin routes. Callers supply links and permission filtering; the wrapper only handles drawer visibility.
- Standard pages subtract `--app-navbar-height` when filling the remaining viewport. Editors use flex layout beneath their own headers so notices can grow without covering the workspace.
- `app/manage/layout.tsx` owns the persistent `TeamShell` and right-side loading boundary. Library and asset detail routes render only their content; they must not create another navigation frame. `TeamShell` and the global header share `isFullWindowEditorPath` from `app/manage/constants.ts`, covering collection, scene and activity detail routes. Library sizing follows the active route, so cached, hidden pages cannot change the current work surface's padding.
- The asset library opens `AssetInspector` in `TeamFrame`'s optional right island. The `assetId` search parameter uses native history to preserve the mounted library and its local state; regular card navigation is intercepted while the existing detail href supports direct links and modified clicks. `AssetDetailView` owns the same detail reads, capabilities and writes in either presentation. Content-change events refresh the loaded library pages in place after writes.

## Activity editing

`ActivityDetailRoute` owns the full-window activity shell and team alignment. Activity cards, map-dialog edit links and activity references in `AssetUsagePanel` open this route in a new browser tab. Creating an activity refreshes the library in place and offers an edit action in the success toast.

For both activity types, `ActivityEditor` owns the draft and exposes settings, map, save actions and optional point details through `renderWorkspace`. The route places these in the shared `EditorHeaderBar` and `ManageGridLayout`: settings on the left, an isolated `ActivityLocationMap` viewer in the center, and sidebar tabs on the right. Danmaku uses `ActivityPlacements` / `ActivityRecords` tabs. Shop check-in adds the point inspector, with activity settings, check-in radius and the point list on the left; selecting a point in the list or map opens its inspector. Point fields, images, reward images and archive/restore actions edit the same activity draft. The layout's container queries also own tablet and mobile stacking; settings and sidebar content scroll independently, including empty, read-only and archived activities.

The top-bar save submits one activity form shared by the settings and point-inspector fields through explicit form ownership. The association form stays separate. Point validation reveals an invalid point's inspector even when another sidebar tab is active. The point inspector and association panel remain mounted across tab changes; record moderation and tab switching preserve the draft and map viewer. `ActivityImagePicker` keeps image selection and upload within the existing asset workflow, with wrapping controls that fit the narrow inspector.

Activity detail reads do not subscribe to general content-change events: record moderation and association writes must not replace an unsaved activity draft. Explicit activity saves or conflict reloads refresh the editor's version; a failed save preserves the draft until the user reloads. `ActivityLocationMap` updates form coordinates through its isolated viewer messages, without writing saved placements. API calls, capabilities and optimistic-lock contracts remain in the existing activity components and client API.

## Protected boundaries

- Never edit `.next/`, `next-env.d.ts` or `*.tsbuildinfo`.
- Treat `package-lock.json` as npm-managed.
- Keep `public/js/viewer/` changes separate: it is a standalone iframe runtime, not React UI.
- Do not change auth, permission, API, database or route semantics as part of component-system work.
