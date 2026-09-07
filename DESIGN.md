# Design

## World

The interface behaves like a professional video transport console compressed into a desktop command palette. Time is the product material: recorded moments occupy a precise horizontal ruler and a single tangerine chase light marks NOW.

## Palette

- Graphite `#101110` page ground
- Raised graphite `#181a18`
- Cool white `#f3f3ed`
- Muted sage-gray `#9ba198`
- Electric tangerine `#ff5c22`, the only accent

## Typography

Use Geist Sans for Korean and Latin UI copy and Geist Mono only for timestamps, duration, and technical state. Display copy is left aligned, bold, and compact. Body copy stays under 70 characters per line.

## Shape and Material

Panels are flat with one-pixel graphite borders. Work surfaces use 12px corners; compact controls may be fully rounded. Shadows are reserved for the live command dock and carry a soft downward offset. No decorative glass, gradients, or glow.

## Interaction

The authored motion is the orange NOW marker advancing as one-second segments enter the buffer. Buttons depress by one pixel. Gesture arming uses a brief progress sweep; all continuous motion stops under reduced-motion preferences.

## Responsive

Desktop is an asymmetric 65/35 workspace. Tablet stacks command controls above the timeline. Mobile becomes a single live monitor followed by actions, timeline, and analysis; nothing requires hover.


## Browser PiP workspace

PiP uses the existing graphite/tangerine palette and the app's actual self-hosted Noto Sans KR
and IBM Plex Mono fonts. Its stylesheet is `browser-capture-panel.module.css`; the separate PiP
document receives the loaded app CSS with the existing CSP nonce and font-variable classes.

The compact 380×240 view is a replay remote: one orange primary action, two quiet capture controls,
a measured buffer track, and a low-emphasis privacy line. The expanded 380×640 view keeps its header,
capture strip and question composer fixed while only conversation content scrolls. Width and height
are requests; the browser controls the final window dimensions.

User questions have compact right-aligned bubbles and capture-source labels. AI answers sit directly
on the page with a small brand signature. Changes appear in a paired before/after disclosure; region
selection dims only the area outside the selected rectangle. Preserve keyboard focus, disabled and
pending states, Korean IME input, and reduced-motion preferences. Enter sends a text follow-up;
Shift+Enter inserts a line break. New conversations and compact mode use labeled icon buttons.
