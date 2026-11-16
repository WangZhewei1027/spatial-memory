---
name: Spatial Memory — Homepage
description: A white exhibition canvas for real spatial content and the tools that create it.
colors:
  primary: "hsl(0 0% 10%)"
  background: "hsl(0 0% 100%)"
  secondary: "hsl(0 0% 96%)"
  muted-foreground: "hsl(0 0% 40%)"
  accent: "hsl(0 0% 94%)"
  border: "hsl(0 0% 88%)"
  ring: "hsl(0 0% 25%)"
  landing-paper-muted: "hsl(0 0% 39%)"
  landing-shadow: "hsl(0 0% 0%)"
typography:
  display-xl:
    fontFamily: 'var(--font-geist-sans), "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
    fontSize: "4.5rem"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "normal"
  display-lg:
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "normal"
  display:
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  heading-lg:
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.375
  heading-md:
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.375
  body-md:
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.75rem"
  body-sm:
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body-xs:
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  control-label:
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
rounded:
  control: "6px"
  action: "8px"
  frame: "12px"
  stage: "16px"
  phone-image: "20px"
spacing:
  inline-sm: "8px"
  inline: "12px"
  detail: "16px"
  group: "24px"
  column: "32px"
  split: "64px"
  section: "104px"
  section-mobile: "60px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.control-label}"
    rounded: "{rounded.action}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "hsl(0 0% 10% / 0.9)"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    typography: "{typography.control-label}"
    rounded: "{rounded.control}"
    padding: "0 32px"
    height: "40px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.control-label}"
    rounded: "{rounded.action}"
    padding: "0 22px"
    height: "48px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
  chapter-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.control-label}"
    rounded: "8px 8px 0 0"
    padding: "16px 12px"
  chapter-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
  operation-module:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.frame}"
    padding: "32px"
  screenshot-frame:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.frame}"
    padding: "14px 14px 0"
  footer-nav:
    textColor: "{colors.muted-foreground}"
  faq-trigger:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "16px 0"
---

# Design System: Spatial Memory — Homepage

## Overview

**Creative North Star: "Digital exhibition wall"**

A continuous white canvas presents real places, product screenshots and mobile AR imagery. Black headings and actions establish hierarchy; gray supporting copy, generous spacing and fine dividers make the page easy to scan. The interface stays restrained so the product and its spatial content carry the visual detail.

This is a record of the implemented homepage, scoped to the `main.landing-page` subtree in [LandingPage](app/components/LandingPage.tsx), [LandingCta](app/components/LandingCta.tsx) and [the homepage stylesheet](app/components/landing-page.css). The shared authority remains [docs/design-system.md](docs/design-system.md), with typography and primitives defined in [Tailwind configuration](tailwind.config.ts), [Text](components/ui/typography.tsx) and [global styles](app/globals.css). These homepage tokens do not redefine console routes. The global navbar is rendered outside this subtree by [the root layout](app/layout.tsx) and retains its existing implementation, appearance and behavior.

**Key Characteristics:**

- White section backgrounds with black, white and gray interface colors.
- Shared bilingual sans typography with a distinct marketing display scale.
- Real Dongming workspaces and retained mobile AR photographs.
- Open content rows, fine dividers and rectangular image frames.
- Responsive composition and visible keyboard focus.

The surface sequence and audience decisions remain in [the homepage brief](.impeccable/surfaces/app-components-landingpage-tsx.md). This file records reusable implementation facts; it does not extend homepage composition rules to other surfaces.

## Colors

The interface palette is neutral. Photographs and product screenshots retain their real colors.

### Primary

- **Ink** (`primary`) carries headings, primary actions, selected product tabs and dark phone surrounds. The local foreground and image-ink aliases use the same value.

### Neutral

- **White canvas** (`background`) continues through every homepage section and screenshot surround; it also provides inverse text on dark controls. The local stage, paper and primary-foreground aliases share this value.
- **Soft control gray** (`secondary`) distinguishes inactive mobile tabs and desktop tab hover. The local muted alias shares this value.
- **Supporting gray** (`muted-foreground`) separates descriptions, footer navigation and captions from headings.
- **Hover gray** (`accent`) provides outline and ghost button hover feedback.
- **Divider gray** (`border`) separates sections, open articles, screenshot frames and operation modules.
- **Focus gray** (`ring`) marks keyboard focus. **Frame-caption gray** (`landing-paper-muted`) belongs to the hero screenshot caption.
- **Shadow black** (`landing-shadow`) is used with opacity for image and device depth.

**The Local Canvas Rule.** Keep the white marketing palette inside the homepage subtree. Console themes and the unchanged global navbar continue to use the shared system.

## Typography

All roles inherit the shared font stack recorded on `display-xl`: Geist for Latin characters, the existing Chinese system-font chain for Chinese, then platform fallbacks. The stack is implemented once in Tailwind and applied by the root layout; this record does not introduce another font declaration in application code.

The frontmatter captures the observed homepage ramp: `display-xl` for the desktop hero, `display-lg` for major section headings, `display` for smaller section headings and narrow-screen display text, `heading-lg` for product and operation titles, and `heading-md` for workflow steps. Descriptions use `body-md`; short support copy uses `body-sm`; attribution and compact metadata use `body-xs`. Buttons and tabs use `control-label`. The shared console `headingXl` remains part of the shared system but is not a homepage display role.

The hero uses the largest display size above 1100px. Between 768px and 1100px, its size becomes 3rem while retaining the desktop hero line height; below 768px it uses the smaller display role. Major section display headings switch at the shared 768px breakpoint; the workflow, operations and FAQ headings retain the smaller display role throughout. Headings balance their wrapping, and the hero has an explicit break between its two translated lines. Workflow body copy uses a tighter line height (1.6) on mobile.

**The Shared Type Rule.** Preserve the bilingual font chain, semantic heading order and Text variants. Marketing display sizes belong to marketing content; do not carry them into console interfaces or tighten Chinese letter spacing.

## Layout

The centered shell has a maximum width (1280px), with desktop side margins (48px). At 1100px and below the side margins become 32px, then 20px below 768px. Common sections use the `section` spacing on both block edges, reducing to `section-mobile` on narrow screens. Specialized workflow, AR and final-action sections keep their own observed spacing rather than forcing every block onto one height.

Wide screens generally pair headlines with supporting copy. The operations heading and introduction instead form one left-aligned block (maximum width 720px). Product descriptions occupy three columns; at 1100px they become two columns with capabilities below. The workflow has four columns, while operations and use cases use two. Below 768px, these content pairs stack, the workflow retains two columns, and the five product tabs form a three-column grid. Product-copy containers grow with translated content; they are not fixed-height text boxes. Actions and the Agent workflow wrap.

Product screenshots fill their frames with natural height. Their declared width is 1512px; the scene screenshot is 805px high and the other four workspace screenshots are 749px high. Preserve those intrinsic ratios. The real mobile AR image retains its portrait ratio; the AR collage rearranges within a smaller gallery on mobile. These are evidence assets, not recreations of a working console.

## Elevation & Depth

The page is mostly flat: white surfaces, spacing and thin borders organize the content. Soft shadows separate the hero screenshot and mobile device imagery. Shared buttons retain their existing subtle shadows. The global navigation shadow belongs to the shared navigation system outside the homepage scope.

The exact shadow and motion values are recorded in the sidecar. The hero image stage has one entrance animation (850ms), moving upward from a small offset (20px) while opening its clip. It runs only when the user has no reduced-motion preference. Buttons and tabs retain shared state transitions; the page has no scroll-driven animation system.

**The Image Depth Rule.** Use the implemented soft depth to separate overlapping image layers; keep the surrounding section canvas white and visually quiet.

## Shapes

Controls use gently curved corners. Main action rows use the larger `action` radius, screenshot frames and operation modules use `frame`, and the hero stage uses `stage`. Product screenshots have smaller inner corners (`control`). The phone imagery has a rounded device surround and uses `phone-image` for the inner image on desktop. Narrow screens reduce the hero stage and phone corners to fit their smaller dimensions.

Dividers, screenshot frames and operation modules use fine strokes (1px). Workflow and use-case rows remain open; the two operation modules use outlined white containers. Dark device surrounds and the caption attached to the AR landscape image are part of image presentation; they do not create dark page sections.

## Components

### Buttons

The primary CTA reuses the shared Button and links to the workbench when authenticated, otherwise sign-in. Its label is translated. Primary and ghost actions in the hero and final action rows have a minimum height (48px) and the frontmatter's action padding; narrow screens reduce horizontal padding to 17px. The standalone outline guide action retains the shared large-button dimensions; outline buttons inside action rows adopt the row dimensions. Primary hover uses the same ink with lower opacity; outline and ghost hover use `accent`.

Homepage links and buttons receive a visible focus outline (2px) with an offset (5px). Shared component focus rings remain present. Inline SVG icons accompany readable labels and are hidden from assistive technology when decorative.

### Product chapters

Shared Radix-backed Tabs provide the five workspaces and default to the scene chapter. Desktop tabs have a minimum height (56px); mobile tabs use a minimum height (44px). The active tab is ink with white text and no shadow. Each panel combines a title, description, three concrete capabilities and the corresponding real screenshot. Retain the tab semantics and keyboard behavior from the shared component.

### Screenshot frames and mobile imagery

The repeated product frame uses a white fill, fine border, compact inset and caption row. At narrow widths the inset becomes 5px and the repeated workspace label in the caption is hidden. Images use `next/image` with actual dimensions and responsive size hints. The hero map and mobile image load with priority; later gallery images retain ordinary loading behavior.

**The Real Evidence Rule.** Preserve actual Dongming workspace images, their map attribution, the existing mobile AR images and their translated alternative text. Do not manufacture interface content or product metrics for the homepage.

### Operation modules and open rows

Team and Agent information use two equal white outlined modules, with a gap (24px) and internal padding (32px). Below 768px they stack, reducing the gap (16px) and padding (24px). Each module leads with its title, then description, then supporting facts. Team roles and saved-content behavior use a semantic description list; its label-and-value grid stacks on mobile. Roles are plain text, not controls. The Agent workflow is an ordered list of text steps with small arrow icons and natural wrapping, followed by a guide link. It has no detached step numbers or standalone decorative module icons.

The separate four-step product workflow retains small tabular indices beside titles and body copy. Use-case articles remain open rows with fine separators. Both patterns retain the continuous white canvas.

### FAQ and footer navigation

The FAQ reuses the shared Accordion with one item open at a time and supports collapsing it. Question triggers have a minimum height (72px), normal body-size text and the existing chevron state. Answers use the shared body Text style. Footer navigation is a simple row of translated links with subdued text that darkens on hover; it remains a row as the surrounding footer stacks on mobile. The lab identity, credit and filing link are preserved.

## Do's and Don'ts

### Do:

- **Do** keep homepage section backgrounds white and use typography, spacing and neutral dividers for hierarchy.
- **Do** reuse shared Text, Button, Tabs and Accordion components and preserve their keyboard behavior.
- **Do** verify both Chinese and English layouts at desktop and mobile widths.
- **Do** preserve real screenshot proportions, attribution, mobile AR imagery and the lab credit.

### Don't:

- **Don't** apply the homepage palette or display sizes to console routes.
- **Don't** change the global navbar as part of this homepage visual system.
- **Don't** alternate dark and light homepage section backgrounds.
- **Don't** replace real product evidence with invented controls, statistics or claims.
