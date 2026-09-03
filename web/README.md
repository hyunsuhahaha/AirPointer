This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The local Agent bridge requires an installed and signed-in Codex CLI. Select a Codex task in the page before enabling gestures. Holding a palm for two seconds freezes the selected replay interval and opens a prompt dialog; the capture is sent only after the user chooses or types a prompt and confirms. `OPENAI_API_KEY` is only used by the separate OpenAI image-analysis controls.

Enabling gestures first requests browser camera access. After the camera starts, the same action opens `airpointer://start`, which starts the portable Windows companion and its transparent always-on-top overlay. Run `portable/AirPointer.exe` once after downloading it so Windows can register the custom protocol for the current user; no installer or administrator permission is required.

Replay sends a temporary **Replay Capsule** containing overview contact sheets and the original timestamped WebM segments. The Agent receives a local manifest and can run `scripts/replay-frame.mjs <manifest> -0.5` to recover the full-resolution frame exactly 0.5 seconds before the gesture. Capsules are deleted after 60 minutes.


You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
