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

The authored motion is the orange NOW marker advancing as one-second segments enter the buffer. Buttons depress by one pixel; all continuous motion stops under reduced-motion preferences.

## Responsive

Desktop is an asymmetric 65/35 workspace. Tablet stacks command controls above the timeline. Mobile becomes a single live monitor followed by actions, timeline, and analysis; nothing requires hover.


## Browser PiP workspace

PiP is a quiet export utility above the user's work. Do not show the product name, logo, conversational
slogans, large empty-state headings, or decorative motion. Keep buffer length, send window, and recording
state in the compact header. The three modes appear in priority order: Manual, Agent Link, Local Folder.

Manual is the primary visual workflow. Keep representative frames on one horizontal timeline, use `…`
to reveal frames between them, and start with zero selected images. A frame supports native image drag and
click-to-enlarge; selection is a separate checkbox. Place refresh beside the selected count without adding
another row. Refresh replaces the timeline only after the new snapshot is ready. The multi-download action
stays below the timeline.

Agent Link and Local Folder use the same compact mode area and one primary generation action. Keep status,
errors, copied prompts, and link deletion legible. The expanded size request is 520×560; the browser owns
the final window size. Use self-hosted fonts with the existing CSP nonce and preserve keyboard focus,
loading states, reduced motion, and horizontal scrolling on narrow windows.

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
