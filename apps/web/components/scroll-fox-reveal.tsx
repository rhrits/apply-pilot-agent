"use client";

import { useEffect, useRef } from "react";

export function ScrollFoxReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        node.classList.add("is-visible");
        observer.disconnect();
      }
    }, { threshold: 0.25 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className="scroll-fox-section" aria-label="UplyFox assistant">
      <div className="scroll-fox-stage">
        <div className="scroll-fox-glow" />
        <img className="scroll-fox" src="/uplyfox-extension-mascot.svg" alt="UplyFox assistant fox" />
        <span className="scroll-fox-spark" aria-hidden="true">✦</span>
      </div>
      <div className="scroll-fox-copy">
        <span className="eyebrow">Your application sidekick</span>
        <h2>Ready when<br /><span>you are.</span></h2>
        <p>Bring your verified story to every application. UplyFox keeps the busywork light and the final decision yours.</p>
      </div>
    </section>
  );
}
