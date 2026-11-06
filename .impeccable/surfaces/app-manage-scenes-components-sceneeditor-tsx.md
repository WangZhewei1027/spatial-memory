---
version: 1
slug: "app-manage-scenes-components-sceneeditor-tsx"
primary_target: "app/manage/scenes/components/SceneEditor.tsx"
related_targets: ["app/manage/scenes/components/scene-editor.css"]
---

# Scene editor

- Scope: /manage/scenes/[id], existing scene assets only. Mode: Operate.
- User confirmed desktop-first composition; narrow screens support preview and basic editing.
- User pins Unity and Timeline UX. Code-led local composition within the incumbent token system; no new global brand or generated visual assets.
- Workflow provenance: Impeccable `reference/new-work.md` §3 exempts "a local extension or a precisely specified narrow request" from the concept-seed round. This scoped work follows the user's explicit Unity/Timeline direction inside the established management UI. No concept seed, decision comp, or catalog QUALITY BAR card was produced; the source direction contract and checks below govern this code-led implementation.
- Quality bar: fixed tools without overlap; readable object names; visible keys and animation clips; a real 3D subject; named keyboard controls; useful narrow-screen task panels; reliable save status and undo. Save state stays visible on desktop and narrow screens.
- Workflow: add a model from Project assets → select via Hierarchy/viewport/track → edit Inspector → add transform keys → scrub/play → save.
- Direct manipulation: drag library models onto the viewport's ground plane; drag animation clips with a preserved grab offset, 30 fps snapping, local preview and a single undoable commit on release (Escape cancels). Resize the library and timeline with three-dot pointer/keyboard handles, collapsing below their thresholds. Hide the collapsed library handle and restore from the navbar; retain the timeline transport while its tracks are collapsed. Adjacent panes fill the released space.
- Fixed docks: hierarchy/library left, 3D viewport center, inspector right, timeline below. A single selection and playhead bind these together. Remove native Theatre floating UI from the workbench.
- Preserve existing asset CRUD, authorization, schema v1/v2 reading, v2 editing and mini-player compatibility. No added scene tables or publication workflow.
- Keyboard: W/E/R tool modes, F frame, Space play, Ctrl/Command S save, Z undo, Shift Z redo, C/V copy/paste tracks or groups and Delete/Backspace delete the active selection. UI text is not selectable; text fields retain native selection and editing shortcuts.
- Boundaries: no model mesh editing, physics, audio/video sequencing or Unity file interoperability. No promised standalone curve editor.
