---
name: Price Tracker
description: A calm local watchlist for verified price changes.
colors:
  pine: "#163d32"
  ink: "#203a31"
  muted: "#59685f"
  paper: "#fffefa"
  ground: "#f1f4ec"
  line: "#dce3d6"
  green: "#23623e"
  green-bg: "#e7f1e5"
  rust: "#9d492e"
  rust-bg: "#f9eae1"
  amber: "#805b15"
  amber-bg: "#fff2d7"
  accent: "#e3eeab"
  add-surface: "#e4ebdb"
  focus: "#6b8751"
  white: "#fff"
  primary-hover: "#24513f"
  secondary-hover: "#e3eadc"
typography:
  display:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: "1.15"
    letterSpacing: "-.035em"
  title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: "1.5"
    letterSpacing: "-.015em"
  section:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: "1.5"
    letterSpacing: "-.015em"
  body:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "normal"
  product:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "1.5"
    letterSpacing: "normal"
  price:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: "1.5"
    letterSpacing: "-.03em"
  label:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "1.5"
    letterSpacing: "normal"
  button:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: "1.5"
    letterSpacing: "normal"
  chart:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "normal"
rounded:
  surface: "12px"
  control: "7px"
  compact: "6px"
  badge: "5px"
  local-label: "4px"
spacing:
  tight: "4px"
  small: "8px"
  control-gap: "10px"
  compact: "12px"
  medium: "16px"
  row-gap: "20px"
  section: "24px"
  spacious: "32px"
  section-gap: "40px"
  page-gutter: "48px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.pine}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  input-url:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  filter-active:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.compact}"
    padding: "8px 11px"
  status-dropped:
    backgroundColor: "{colors.green-bg}"
    textColor: "{colors.green}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  add-panel:
    backgroundColor: "{colors.add-surface}"
    rounded: "{rounded.surface}"
    padding: "26px 28px 22px"
---

# Design System: Price Tracker

## Overview

**Creative North Star: “Botanical field-guide restraint.”**

A calm local work surface for checking prices. Deep pine, pale sage and warm paper support a compact watchlist whose product names, verified prices and comparison times carry the hierarchy. This direction is recorded in `.impeccable/surfaces/public-index-html.md` and implemented in `public/style.css`.

Trust is visible: unavailable prices remain unknown, a failed check preserves the last verified observation, and every direction has a written status. Local operation and optional email alerts are explicit.

**Key Characteristics:**

- Aligned compact rows with inline history.
- One self-hosted sans family and tabular prices.
- Quiet tonal separation, fine rules and restrained rounded controls.
- Directional color backed by labels and icons.

## Colors

Pine anchors the header, primary actions and selected filters. Ink carries primary text; muted green supports metadata. Paper rows sit on the pale ground, while the add panel uses a slightly deeper sage surface.

Green and its pale background identify drops; rust and its pale background identify increases. Amber identifies check failures. The accent appears in the brand mark, running indicator and text selection. Neutral statuses use subdued gray-green; first-price and pending states use slate tones. Color values in the frontmatter are normative; CSS also contains local border and supporting-text tones.

Do not use status color as the only explanation. An increase must still say “Increased”; a failed check must explain that its displayed price is the last verified price when available.

## Typography

Manrope is self-hosted at `/fonts/manrope.ttf` with a variable weight range of 200–800 and `font-display: swap`. The fallback stack is Segoe UI, sans-serif. There is no remote font dependency.

The desktop page title is 40px/1.15 at weight 600, with tight tracking; at 700px and below it is 32px. List titles are 20px (18px on mobile), section headings 16px, product names 14px, and supporting labels 12px. Base text is 15px/1.5. Price figures are 21px desktop and 22px mobile, weight 600, with tabular numerals; history table values also use tabular numerals.

SVG chart labels explicitly inherit the same font family. Their 12px SVG size becomes 24px at 700px and below to compensate for scaling of the 620 × 165 viewBox. Treat this as chart coordinate sizing, not a 24px HTML body-text rule. The full table supplies exact recorded values.

## Layout

The header and main content share a 1320px maximum width. Desktop gutters are 48px; main top padding is 50px, increasing to 60px at 1500px. The heading pairs the page title and manual-check action. A horizontal link form precedes filters, search and the product list.

Rows use `minmax(210px,1fr) 150px 150px 145px 36px` columns with 20px gaps: product, price, change, checked time and disclosure. Row padding is 24px 20px. Expanded details stay inside the row, with history and a 240px settings column separated by 40px.

At 1050px and below, gutters become 28px, columns tighten and the toolbar stacks. At 700px and below, main gutters become 18px, the form wraps, the primary add button fills the width, and rows become a three-column arrangement: product with disclosure, price with change, then last-checked information. Column headers disappear; the mobile checked time gains a text prefix. Details become one column and the footer stacks. The page heading can wrap without shrinking its action.

## Elevation & Depth

The interface uses no box shadows. Background tones, 1px rules and spacing separate work areas. Product rows remain flat, with paper against sage. Do not add floating-card elevation to the compact list.

## Shapes

Large bounded areas use 12px corners; primary controls use 7px; compact controls and error panels use 6px; status badges use 5px. Rows have straight edges and horizontal separators. Icons are simple outlined SVGs with rounded caps and joins. The collapsed disclosure rotates 180 degrees when expanded.

## Components

### Actions

Primary buttons use pine with white text, shifting to a lighter pine on hover. Secondary actions use a transparent background, a muted border and pine text; hover adds a pale sage fill. Standard buttons are at least 44px high, with 11px 18px padding. Compact variants in row settings and mobile heading are smaller. Disabled controls use 0.55 opacity and a waiting cursor. Removal is an underlined rust text action followed by an explicit confirmation and cancel action.

### Inputs and filters

The product-link field is a paper surface with a quiet sage border and link icon. Its visible prompt is supported by a programmatic label and store-coverage helper. Focus within the container adds a 2px green outline with 2px offset. Other focusable controls use a 3px green outline with 4px offset. Search is a compact transparent field with an icon and accessible label. Filters wrap, expose `aria-pressed`, and use solid pine for selection.

### Product list and states

Each product is an article with its source link, latest verified price, written direction, delta and last-check information. Product-name and chevron buttons both disclose inline history through `aria-expanded` and `aria-controls`. Baseline, pending, unchanged, dropped and increased states remain distinct; failures have a separate explanatory panel and retry action. No target and no verified price have explicit text.

Loading, an empty watchlist, no filter matches, and a disconnected service each have distinct copy and recovery actions. Form errors use an alert region; operation feedback uses a status region; the list exposes loading with `aria-busy`. A skip link reveals itself on keyboard focus. Rerendering attempts to restore the focused control, and unsaved target edits are retained.

### History and settings

History shows first and lowest prices, a restrained green SVG series and a recorded-price table in a native disclosure. Fewer than two observations show an explanatory placeholder. The chart has an accessible text description; its exact values remain available in the table. Target-price settings and manual check/remove actions sit beside history on desktop and below it on mobile.

### Motion

A new verified observation briefly highlights the row, fading from pale yellow-green to paper over 1.5 seconds using `cubic-bezier(.16,1,.3,1)`. Reduced-motion preferences disable this animation and smooth scrolling. Avoid adding motion that competes with price comparisons.

## Do's and Don'ts

- **Do** preserve aligned prices, tabular numerals and explicit comparison context.
- **Do** use the self-hosted Manrope family for chart labels as well as HTML text.
- **Do** preserve keyboard focus, written statuses and complete table access to history.
- **Do** keep errors, pending values and the last successful observation distinct.
- **Don't** replace unknown prices with guesses or decorative placeholders that resemble real values.
- **Don't** turn this local operating dashboard into a decorative metric-card grid.
- **Don't** add shadows or animation that obscure the quiet, flat list hierarchy.
