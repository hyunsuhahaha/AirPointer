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

PiP is a quiet utility above the user's work. Do not show the product name, logo, conversational
slogans, large empty-state headings, orange CTA surfaces, or animated buffer decoration here.
Keep the product branding on the main site. Use neutral graphite controls and short action labels:
리플레이, 화면. 화면 opens a frozen preview with the full screen selected by default; dragging changes
that selection to a region. Only the recording-status dot uses a muted color; buffer duration is a tooltip.

The compact size request is 320×120 and the expanded request is 380×560; the browser owns final
window sizing. Keep capture controls and the text composer fixed while conversation content scrolls.
Use self-hosted Noto Sans KR and IBM Plex Mono with the existing CSP nonce. Preserve keyboard focus,
loading/error states, region selection and reduced motion. Enter sends a text follow-up; Shift+Enter
inserts a line break. Keep help text short and contextual, and do not repeat the brand in AI answers.

For the zero-install demo, “30초 체험하기” reveals exactly three real-development scenarios inside
the existing graphite stage. Each option names the incident and its execution proof; choosing one is
the only launch action. Treat the recording as captured work inside the transport, with no playback
chrome or presentation styling that would make it feel simulated.

**The One-Click Chain Rule.** A scenario choice auto-plays the muted recording. Keep the PiP and its
question hidden until the recorded incident appears, then reveal the expanded demo PiP beside the work
surface. Sample local frames and begin adaptive analysis as soon as playback ends. Do not insert a
second confirmation or require the user to press Analyze. Show the sequence as compact states—incident,
question, AI re-exploration, evidence confirmation—and keep interruption, error, and retry paths legible.

**The Grounded Finish Rule.** The PiP carries the whole outcome: the question, live exploration progress,
answer, and inspectable frame evidence stay visible in the expanded utility window. Pair conclusions with
recorded frames and their timing; the main workspace may mirror the incident record but must not be the
only place where evidence appears.
