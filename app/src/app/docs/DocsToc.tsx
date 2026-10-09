"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

export function DocsToc({ sections }: { sections: [string, string][] }) {
  const [active, setActive] = useState(sections[0][0]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    sections.forEach(([id]) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Documentation sections" className="hidden lg:block">
      <div className="sticky top-24">
        <div className="label mb-3">Contents</div>
        <ul className="space-y-0.5 border-l border-line-soft">
          {sections.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={cx("-ml-px block border-l py-1 pl-3 text-[12.5px] transition-colors", active === id ? "border-cyan text-fg" : "border-transparent text-muted hover:text-fg")}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
