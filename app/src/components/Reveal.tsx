"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Fades and lifts its content into place the first time it scrolls into view.
 * With reduced motion (MotionConfig reducedMotion="user") only the fade remains.
 */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
