import type { Metadata } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Noto_Sans_KR } from "next/font/google";
import { ThemeBoot } from "@/components/theme-boot";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const sans = Noto_Sans_KR({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "방금그거뭐였지 | 놓친 순간을 AI에게",
  description: "화면의 최근 순간을 로컬에 보관하고, 손짓 한 번으로 AI에게 전달합니다.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // proxy.ts allows inline scripts only with this request's nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // The boot script adds the saved theme classes before paint, hence suppressHydrationWarning.
  return <html lang="ko" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
    <head><script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
    <body><ThemeBoot />{children}</body>
  </html>;
}
