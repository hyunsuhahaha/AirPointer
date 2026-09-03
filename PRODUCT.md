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

## Operating Context

The user explicitly starts browser screen sharing. One-second recording segments form a bounded local ring buffer. A palm-to-fist gesture shares the current screen; holding an open palm shares recent context. Manual controls provide the same actions for accessibility and demonstrations.

## Capabilities and Constraints

- The browser can capture a user-selected screen, window, or tab only after permission.
- Browser recordings remain in memory until the user explicitly requests analysis.
- The deployed React app uses a server route for Responses API calls so API keys never enter browser code.
- The native Python AirPointer remains the path for Windows cursor control, UI Automation snapping, and sending directly to a local Codex task.
- The deployed web app sends still images sampled from the replay because model image input is the reliable cross-platform interface.
- Inferred deployment target: Vercel. This can be replaced without changing the browser capture module.

## Brand Commitments

The public product name is “방금그거뭐였지”. The Korean voice should be direct, memorable, and helpful rather than corporate or technical.

## Evidence on Hand

- A working Python AirPointer prototype with hand, wink, gaze, cursor, screen-buffer, and Codex App Server modules exists in this repository.
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
