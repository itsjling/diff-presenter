---
name: Diffsplain
description: Clear code diffs with concise, comprehensive agent notes.
colors:
  desk-canvas: "#e9e2d5"
  reading-paper: "#fbf8f0"
  reading-paper-deep: "#f1ebdf"
  carbon-ink: "#20231f"
  muted-ink: "#73766d"
  quiet-ink: "#aaa99f"
  divider: "#d8d1c4"
  dark-divider: "#333831"
  addition-green: "#2f6c4d"
  addition-wash: "#dce9dc"
  deletion-red: "#a14f45"
  deletion-wash: "#f1ddda"
  review-blue: "#426b7c"
  review-wash: "#dce9ed"
  risk-amber: "#9c7027"
  risk-wash: "#eee3c7"
typography:
  display:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "clamp(38px, 6vw, 72px)"
    fontWeight: 540
    lineHeight: 1
    letterSpacing: "-0.07em"
  headline:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "clamp(26px, 2vw, 36px)"
    fontWeight: 570
    lineHeight: 1.04
    letterSpacing: "-0.055em"
  title:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 620
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist Mono, monospace"
    fontSize: "9px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.12em"
  code:
    fontFamily: "Geist Mono, monospace"
    fontSize: "11.5px"
    fontWeight: 450
    lineHeight: 1.6
rounded:
  key: "4px"
  control: "5px"
  toast: "6px"
  row: "7px"
  callout: "8px"
  dialog: "15px"
  reader: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "13px"
  lg: "20px"
  xl: "28px"
  2xl: "34px"
components:
  reader-sheet:
    backgroundColor: "{colors.reading-paper}"
    textColor: "{colors.carbon-ink}"
    rounded: "0 0 {rounded.reader} {rounded.reader}"
    padding: "0"
  reader-toolbar:
    backgroundColor: "{colors.carbon-ink}"
    textColor: "{colors.reading-paper}"
    rounded: "{rounded.dialog} {rounded.dialog} 0 0"
    height: "60px"
  nav-button:
    backgroundColor: "transparent"
    textColor: "{colors.reading-paper}"
    typography: "{typography.code}"
    height: "60px"
    width: "60px"
  text-button:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.label}"
    padding: "7px 0"
  status-chip:
    backgroundColor: "transparent"
    textColor: "{colors.reading-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 9px"
  file-picker-input:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.code}"
    height: "52px"
  risk-callout:
    backgroundColor: "#eee5d8"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.callout}"
    padding: "17px 18px 14px"
  diff-row-added:
    backgroundColor: "{colors.addition-wash}"
    textColor: "{colors.addition-green}"
    typography: "{typography.code}"
    height: "21px"
  diff-row-deleted:
    backgroundColor: "{colors.deletion-wash}"
    textColor: "{colors.deletion-red}"
    typography: "{typography.code}"
    height: "21px"
---

# Design System: Diffsplain

## Overview

**Creative North Star: "The Review Desk"**

Diffsplain is an open-source developer tool built for pull request review. It uses a measured, editorial system built for close reading. Warm paper surfaces, dark ink, compact mono labels, and a strong split between source evidence and agent notes make the interface feel ordered without making it stark.

The system stays mostly flat. Borders, tone shifts, and spacing separate regions; shadows mark only the main reader and the file picker. The diff remains the main work area, while the narrower note pane adds context in a quieter reading rhythm.

**Key Characteristics:**

- Warm paper and ink palette
- Two-pane review layout
- Sans type for explanation and mono type for evidence
- Flat structure led by borders and tonal layers
- Semantic color for additions, deletions, review markers, and risks
- Brief directional motion with a reduced-motion path

## Colors

The palette uses warm neutrals for long reading sessions and reserves color for review meaning.

### Primary

- **Carbon Ink** (`#20231f`): Main text, the reader toolbar, marks, and strong controls.
- **Review Blue** (`#426b7c`): Focus outlines, hunk markers, and review-related emphasis.

### Semantic

- **Addition Green** (`#2f6c4d`) and **Addition Wash** (`#dce9dc`): Added lines, positive counts, and live state.
- **Deletion Red** (`#a14f45`) and **Deletion Wash** (`#f1ddda`): Deleted lines, error state, and negative counts.
- **Risk Amber** (`#9c7027`) and **Risk Wash** (`#eee3c7`): Risks and points that need close review.
- **Review Wash** (`#dce9ed`): Hunk headers and omitted-range cues.

### Neutral

- **Desk Canvas** (`#e9e2d5`): The page-wide background.
- **Reading Paper** (`#fbf8f0`): The main diff surface and modal surface.
- **Deep Reading Paper** (`#f1ebdf`): The agent-note pane and quiet controls.
- **Muted Ink** (`#73766d`): Supporting text and metadata.
- **Quiet Ink** (`#aaa99f`): Line numbers, minor separators, and placeholders.
- **Divider** (`#d8d1c4`) and **Dark Divider** (`#333831`): Section rules and dark-surface divisions.

**The Meaningful Color Rule.** Use green, red, blue, and amber to convey change or review state; do not use them as decoration.

## Typography

**Display Font:** Geist (with Arial and sans-serif fallback)
**Body Font:** Geist (with Arial and sans-serif fallback)
**Label/Mono Font:** Geist Mono (with monospace fallback)

**Character:** Geist keeps explanation calm and easy to scan. Geist Mono marks code, paths, counts, shortcuts, and small labels as precise interface evidence.

### Hierarchy

- **Display** (540, `clamp(38px, 6vw, 72px)`, 1): Empty-state messages and rare page-level statements.
- **Headline** (570, `clamp(26px, 2vw, 36px)`, 1.04): The main agent summary for the selected file.
- **Title** (620, `19px`): File headings and local section titles.
- **Body** (400, `12px`–`14px`, 1.55–1.62): Agent notes, summaries, and supporting text.
- **Code** (450, `11.5px`, 1.6): Unified diff content.
- **Label** (650, `9px`, `0.12em`, uppercase): Eyebrows and compact section labels.

**The Mono Rule.** Use Geist Mono for code, paths, counts, shortcuts, metadata, and short labels; keep full explanations in Geist.

## Layout

The app shell fills the viewport and holds a centered reader up to `1680px` wide. The top bar is `82px` high. The reader toolbar is `60px` high, and the main sheet uses a `1.72fr / 0.88fr` split with a minimum `340px` note pane. The diff side carries the work; the note side remains narrower and easier to read.

Spacing runs from tight `4px` control details to `28px`–`34px` section insets. Rules and alignment set the rhythm before extra padding does.

At `980px` and below, the panes stack, the change summary leaves the top bar, and the diff keeps a bounded height. At `680px` and below, the reader reaches both screen edges, minor toolbar metadata hides, the picker becomes a bottom sheet, and the code grid keeps its working width inside a horizontal scroll area.

## Elevation & Depth

The system is mostly flat and uses borders, background shifts, and fixed regions for depth. The large reader and modal receive ambient shadows because they sit above the desk canvas; inner notes, rows, and controls stay flat.

### Shadow Vocabulary

- **Reader Ambient** (`0 28px 80px rgb(56 45 30 / 14%)`): The full review sheet only.
- **Modal Ambient** (`0 40px 100px rgb(18 20 17 / 32%)`): The file-picker dialog over its dark backdrop.
- **Active Row Inset** (`inset 2px 0 #20231f`): The selected file row.

**The Flat-by-Default Rule.** Use borders and tonal layers inside the reader; reserve ambient shadows for the full sheet and modal overlays.

## Shapes

The main form language is rectangular with restrained rounding. The toolbar uses `15px` upper corners, the reader uses `18px` lower corners, and the file picker uses `15px`. Interior rows and callouts use `7px`–`8px`; small controls use `4px`–`6px`. Pills appear only for status, presence, and compact identity marks. The square, split-color brand mark remains sharp.

## Components

Components mix editorial reading space with compact review controls. Their states change color, border, underline, or position by a few pixels; they do not rely on large effects.

### Buttons

- **Navigation:** Transparent `60px` square controls on Carbon Ink. Hover adds a faint light fill and shifts the arrow by `3px`.
- **Text action:** Small semibold Geist text with a quiet underline. Hover darkens the underline.
- **Close control:** Deep Reading Paper, a `1px` Divider border, `5px` radius, and compact mono text.
- **Focus:** All buttons use a `2px` Review Blue outline with a `3px` offset.

### Chips

- **Status:** Transparent rounded labels with a `1px` state-colored border, compact uppercase mono text, and `6px 9px` padding.
- **State:** Green marks added files, red marks deleted files, amber marks renamed files, and violet marks binary files.

### Cards / Containers

- **Reader sheet:** Reading Paper with `18px` lower corners, one thin outer border, and the Reader Ambient shadow.
- **Summary pane:** Deep Reading Paper with a soft white top wash and a Divider border against the diff.
- **Risk callout:** A warm amber-neutral fill, `1px` border, `8px` radius, and `17px 18px 14px` padding.
- **Modal:** Reading Paper, `15px` radius, a dark backdrop, and the Modal Ambient shadow.

### Inputs / Fields

- **Search field:** A borderless `52px` mono input between top and bottom Divider rules.
- **Focus:** The input removes its own outline because the shared field frame and global keyboard focus system carry the state.
- **Placeholder:** Quiet Ink, with the shortcut shown as small supporting mono text.

### Navigation

The dark reader toolbar holds previous and next controls, the current path, file count, search hint, status, and change totals. The current path truncates rather than wrapping. Below `680px`, nonessential labels hide while navigation and change counts stay visible.

### Diff Rows

Diff rows use a fixed grid for old line, new line, marker, and code. Additions and deletions use pale horizontal washes with dark semantic text. Hunk rows use Review Wash. Metadata stays neutral, and omitted ranges use a faint Review Blue band. Hover adds only a low-opacity ink wash.

### Agent Notes

The note pane starts with a large summary title and lead, then divides reasons and details with thin rules. Risks sit in the only rounded inner callout. The agent signoff stays fixed at the pane foot.

## Do's and Don'ts

### Do:

- **Do** keep the warm paper and Carbon Ink base on review surfaces.
- **Do** reserve semantic colors for additions, deletions, review structure, and risks.
- **Do** use Geist Mono for code and compact evidence, and Geist for explanation.
- **Do** use borders and tonal layers before adding a shadow.
- **Do** keep the diff wider than the note pane on large screens.
- **Do** honor both responsive breakpoints and `prefers-reduced-motion`.

### Don't:

- **Don't** use semantic green, red, blue, or amber as general decoration.
- **Don't** turn every inner region into a rounded card.
- **Don't** add ambient shadows to rows, notes, or routine controls.
- **Don't** replace the code grid with a proportional font.
- **Don't** let secondary metadata crowd navigation on small screens.
