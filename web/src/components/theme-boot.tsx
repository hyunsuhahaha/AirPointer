"use client";

import { useLayoutEffect } from "react";
import { applyTheme, readTheme } from "@/lib/theme";

// React resets <html>'s attributes when it hydrates, dropping the classes the
// boot script added before paint. Put them back in the same commit.
export function ThemeBoot() {
  useLayoutEffect(() => { applyTheme(readTheme(), document.documentElement); }, []);
  return null;
}
