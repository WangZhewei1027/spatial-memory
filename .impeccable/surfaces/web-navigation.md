---
version: 1
slug: "web-navigation"
primary_target: "components/navbar.tsx"
related_targets: ["components/console-navigation.tsx", "components/ui/navigation-island.tsx", "components/breadcrumb-nav.tsx", "app/globals.css", "app/admin/layout.tsx", "app/super-admin/layout.tsx", "app/manage/components/TeamFrame.tsx", "app/manage/content/CollectionHeaderBar.tsx", "app/manage/scenes/components/SceneToolbar.tsx", "app/instructions/layout.tsx"]
---

# Shared web navigation

- User direction: unify all web page navbars in the existing editor island style; adjust adjacent layout where needed. This extends the incumbent visual system without changing product behavior.
- Hierarchy: navigation identifies the current team/page or editor document and offers return, language, account and document actions. Content remains the primary work area; page headings and content tools do not become extra navigation islands.
- Surface: solid semantic background, 12px radius and one offset soft shadow, shared through `NavigationIsland`. Rows are at least 48px tall. Outer gutters are 12px on desktop and 8px below 640px. The scene toolbar can grow for its mobile save status and notices.
- Structure: the global header remains in document flow; map and scene editors own their full-window header. Team, admin and super-admin routes share `ConsoleNavigation`: a 224px desktop island and an in-flow mobile entry that opens a labeled drawer. Links, team parameters, permissions and editor portals stay with their existing owners.
- Adaptation: long identity text truncates with a complete title; language/account actions remain visible. Remaining viewport heights use `--app-navbar-height`. Desktop sidebars and mobile drawers scroll when navigation exceeds the available height.
- Verification: live desktop and 320/375px mobile navigation, Chinese/English, drawer closing after navigation, editor layout and disabled save state; shared dark styling checked with a static copy of rendered navigation. No database writes required.
- Detector exceptions: the existing scene timeline's 2px left edge marks the asset drop position, and its grid is a time measurement surface. Neither is navigation decoration; both remain unchanged.
