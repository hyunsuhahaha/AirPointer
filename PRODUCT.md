# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed: React. Inferred for this build: Next.js App Router, TypeScript, Tailwind CSS, and Vercel deployment so the interactive demo and server-side AI route ship together.

## Users

People working on a PC who see an error, popup, or unexpected screen change and need to understand what happened immediately. The first public audience is the AI Championship 2026 judging panel and voters evaluating the deployed service without installing the Windows application.

## Product Purpose

“방금그거뭐였지” keeps only a short rolling window of the user’s shared screen. On an explicit gesture or button press it sends the current screen or selected recent moments to an AI agent, so the agent can explain not only the result but the sequence that caused it.

## Positioning

Unlike a screenshot shortcut, the product gives an AI the moments immediately before the user asked for help. The core mechanism is disposable local replay, not permanent recording.

## Current Delivery Priority

The competition requires an installation-free core demo. The default public experience is the
browser workspace plus Document Picture-in-Picture, with no executable, extension, or local agent
required. Native AirPointer is an optional Windows expansion. Hosted AI analysis still requires
internet access and a server-side API key.

The pure-browser product is being separated into two purpose-based runtime modes. They are not two
views that keep the same capture engines alive in the background:

- **Education mode:** the camera preview and hand recognition are the primary experience. It teaches
  and demonstrates gestures with immediate visual feedback.
- **Work mode:** shared-screen replay and Document Picture-in-Picture are the primary experience for
  development and general work. It does not request camera permission and must not initialize or
  retain a camera stream, MediaPipe hand recognizer, camera worker, sampling timer, or camera-frame
  canvas. Work-mode actions come from the PiP controls and focus-bound browser shortcuts; native
  global shortcuts remain an optional installed-app capability.

Changing from Education mode to Work mode must release the camera runtime rather than merely hide
its preview. Development, document, and operations use cases are profiles inside Work mode, not
separate top-level modes.

The PiP workspace shows buffer status and detected before/after images, supports current/replay
capture and a frozen-preview region picker, and supports text-only follow-up questions. Region
selection works with pointer dragging or arrow keys (Shift resizes). No images are sent for a
text-only follow-up; only bounded recent conversation text is included. All browser triggers
share an in-flight request guard.

## Operating Context

In Work mode, the user explicitly starts browser screen sharing. One-second recording segments form
a bounded local ring buffer, and PiP buttons or focus-bound browser shortcuts trigger analysis. The
camera is not part of this runtime. In Education mode, the user explicitly grants camera access and
uses the visible preview to learn and demonstrate gestures without keeping the work-mode screen
capture stack active. Manual controls remain available for accessibility and demonstrations.

## Capabilities and Constraints

- The browser can capture a user-selected screen, window, or tab only after permission.
- Browser recordings remain in memory until the user explicitly requests analysis.
- The deployed React app uses a server route for Responses API calls so API keys never enter browser code.
- The native Python AirPointer remains the path for gesture-driven local screen capture (mouse-drag region selection, palm-hold replay) and sending directly to a local Codex task. It does not control the OS mouse cursor.
- A capture's prompt can optionally include the last 30 seconds of copied text alongside window/click activity, so the agent knows what the user recently copied, not just clicked. Off by default: clipboard content can carry meaningfully more sensitive material than a window title or button name, so it needs an explicit opt-in rather than riding along with window/click tracking automatically.
- A replay capture's detected-change hint names the actual UI control when Windows' accessibility tree exposes one (e.g. "저장 버튼"); when an app exposes no accessibility tree at all (some games, custom-rendered UI), the same region is re-read with Windows' own on-device OCR instead, falling back to a coarse screen-quadrant phrase only if both find nothing -- all three paths resolve locally, no vision model call.
- Text the user has selected on screen at the moment a capture is triggered is read (via UI Automation, or a Ctrl+C fallback that safety-checks the target and restores the clipboard immediately) and attached to the prompt, so the agent gets the exact wording instead of re-reading it off a screenshot. Always on, unlike the clipboard-history opt-in above: it only ever reflects what the user is already pointing at for this specific capture, not a rolling log of unrelated past copies.
- The deployed web app sends still images sampled from the replay because model image input is the reliable cross-platform interface.
- Inferred deployment target: Vercel. This can be replaced without changing the browser capture module.

## Brand Commitments

The public product name is “방금그거뭐였지”. The Korean voice should be direct, memorable, and helpful rather than corporate or technical.

## Evidence on Hand

- A Python AirPointer companion with hand tracking, hotkeys, screen buffering, and Desktop paste delivery exists in this repository; the active native delivery path uses Desktop paste.
- Automated tests cover the native interaction and replay logic.
- No customer testimonials, usage metrics, awards, partner logos, or performance claims exist and must not be fabricated.

## Product Principles

- Show what happened before asking the user to explain it.
- Record only after explicit permission and forget automatically.
- Keep manual controls alongside gestures.
- Make privacy state visible at all times.
- Demonstrate real behavior before making claims.

## Accessibility & Inclusion

Core capture and analysis actions must work by keyboard and pointer without gestures. Motion respects reduced-motion preferences, controls have visible focus, and status is announced to assistive technology.
