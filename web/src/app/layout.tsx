import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_KR({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "방금그거뭐였지 | 놓친 순간을 AI에게",
  description: "화면의 최근 순간을 로컬에 보관하고, 손짓 한 번으로 AI에게 전달합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="ko" className={`${sans.variable} ${mono.variable}`}><body>{children}</body></html>;
}
