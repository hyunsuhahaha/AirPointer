import { useId } from "react";
import { SQUARE } from "@/lib/usage-example-game";

// The example game's 480×270 scene. `viewBox` crops it, which is how the
// Manual crop and its attachment thumbnail are drawn.
export function GameScene({ hair, sun = true, swing, square, slash = false, enemyHit = false, viewBox = "0 0 480 270", className }: {
  hair: boolean; sun?: boolean; swing: number | null; square: boolean; slash?: boolean; enemyHit?: boolean; viewBox?: string; className?: string;
}) {
  const p = swing === null ? null : Math.min(1, Math.max(0, swing));
  const eased = p === null ? 0 : 1 - (1 - p) ** 3;
  const armAngle = p === null ? -55 : -120 + 190 * eased;
  const lunge = p === null ? 0 : Math.sin(p * Math.PI) * 10;
  const knock = enemyHit ? 8 : 0;
  // Several scenes share a page (game, thumbnails, crop), so gradient ids must be unique.
  const id = useId();
  const sky = `${id}-sky`;
  const slashFill = `${id}-slash`;
  return <svg className={className} viewBox={viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7cc6f0" /><stop offset="1" stopColor="#cdebf7" /></linearGradient>
      <linearGradient id={slashFill} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0" /><stop offset=".55" stopColor="#e6fbff" /><stop offset="1" stopColor="#7fe3ff" /></linearGradient>
    </defs>
    <rect width="480" height="270" fill={`url(#${sky})`} />
    {sun && <circle cx="400" cy="52" r="24" fill="#ffd43b" stroke="#f5b800" strokeWidth="3" />}
    <path d="M0 196 Q60 150 120 186 T250 176 T380 168 T480 180 V230 H0Z" fill="#8fcf8a" />
    <path d="M0 212 Q90 186 180 206 T360 200 T480 206 V230 H0Z" fill="#6fb86b" />
    <rect y="220" width="480" height="50" fill="#7a5a3a" />
    <rect y="220" width="480" height="8" fill="#5c9e4f" />
    {[30, 96, 170, 262, 340, 430].map((x) => <rect key={x} x={x} y="236" width="18" height="6" rx="3" fill="#6a4c30" />)}

    {/* Enemy slime */}
    <g transform={`translate(${310 + knock} 222)`}>
      <ellipse cx="0" cy="0" rx="34" ry="5" fill="#000" opacity=".15" />
      <path d="M-32 0 C-34 -34 -14 -52 0 -52 C14 -52 34 -34 32 0 Z" fill={enemyHit ? "#ffffff" : "#8a5cf0"} stroke="#4a2a9a" strokeWidth="2.5" />
      <circle cx="-10" cy="-28" r="5" fill="#fff" /><circle cx="10" cy="-28" r="5" fill="#fff" />
      <circle cx="-9" cy="-27" r="2.5" fill="#1d1238" /><circle cx="11" cy="-27" r="2.5" fill="#1d1238" />
    </g>

    {/* Hero */}
    <g transform={`translate(${150 + lunge} 222)`}>
      <ellipse cx="0" cy="0" rx="22" ry="4" fill="#000" opacity=".15" />
      <rect x="-11" y="-26" width="8" height="26" rx="3" fill="#3b3f63" />
      <rect x="3" y="-26" width="8" height="26" rx="3" fill="#3b3f63" />
      <rect x="-15" y="-60" width="30" height="38" rx="8" fill="#2f6fd6" stroke="#1d4796" strokeWidth="2" />
      <rect x="-15" y="-34" width="30" height="5" fill="#8a5a2b" />
      <circle cx="0" cy="-76" r="17" fill="#ffd9b8" stroke="#c98f67" strokeWidth="2" />
      <circle cx="6" cy="-77" r="2.2" fill="#2a2a2a" />
      <path d="M4 -69 q4 2 8 0" stroke="#a0574a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {hair
        ? <path d="M-18 -78 C-22 -92 -10 -100 -2 -98 L2 -108 L6 -97 L14 -104 L14 -93 L22 -94 L17 -82 C12 -88 4 -90 -4 -88 C-10 -86 -14 -82 -18 -78 Z" fill="#ffd21f" stroke="#c99a00" strokeWidth="2" strokeLinejoin="round" />
        : <path d="M-7 -88 q5 -4 10 -2" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".85" />}
      {/* Sword arm, pivoting at the shoulder */}
      <g transform={`translate(8 -50) rotate(${armAngle})`}>
        <rect x="0" y="-4" width="16" height="8" rx="4" fill="#ffd9b8" stroke="#c98f67" strokeWidth="1.5" />
        <rect x="14" y="-7" width="5" height="14" rx="2" fill="#6b4a22" />
        <path d="M19 -3 H64 L70 0 L64 3 H19 Z" fill="#e8eef6" stroke="#8a97a8" strokeWidth="1.5" />
      </g>
    </g>

    {slash && p !== null && <path d="M168 104 Q246 118 238 206 Q228 140 168 104 Z" fill={`url(#${slashFill})`} opacity={Math.sin(p * Math.PI)} />}
    {/* The bug: a flat, fully opaque box with no styling at all. */}
    {square && <rect x={SQUARE.x} y={SQUARE.y} width={SQUARE.size} height={SQUARE.size} fill="#ffe600" />}
  </svg>;
}
