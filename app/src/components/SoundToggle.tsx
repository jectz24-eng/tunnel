"use client";

import { useEffect } from "react";
import { resumeSoundOnGesture, setSoundEnabled, useSoundEnabled } from "@/lib/sound";
import { cx } from "./ui";

/** Sound is off by default; turning it on is the user gesture that unlocks audio. */
export function SoundToggle({ className }: { className?: string }) {
  const on = useSoundEnabled();
  useEffect(() => resumeSoundOnGesture(), []);
  return (
    <button
      onClick={() => setSoundEnabled(!on)}
      aria-pressed={on}
      aria-label={on ? "Turn sound off" : "Turn sound on"}
      title={on ? "Sound on" : "Sound off"}
      className={cx("flex size-8 items-center justify-center rounded-[10px] border border-line text-fg-2 transition-colors hover:border-muted/50 hover:text-fg", on && "border-cyan/40 text-cyan", className)}
    >
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
        <path d="M1 5h3l4-3.5v11L4 9H1z" fill="currentColor" opacity="0.85" />
        {on ? (
          <g stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round">
            <path d="M10.5 4.5c.9.8.9 4.2 0 5" />
            <path d="M12.5 2.6c2 1.9 2 6.9 0 8.8" />
          </g>
        ) : (
          <path d="M10.5 4.5l4 5M14.5 4.5l-4 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
