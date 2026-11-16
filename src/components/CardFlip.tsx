"use client";

import { useState } from "react";

/** **قلبُ البطاقة** (البند ٥) — وجهان من المسار الموقَّع نفسه، يُقلبان بالنقر أو اللمس أو لوحة المفاتيح (زرٌّ حقيقي).
 *  والحركةُ هادئة، ومن طلب تقليل الحركة في جهازه يرى الوجهَ الآخر بلا دوران (`motion-reduce`). */
export function CardFlip({
  frontUrl,
  backUrl,
  L,
}: {
  frontUrl: string;
  backUrl: string;
  L: { alt: string; flip: string; front: string; back: string };
}) {
  const [back, setBack] = useState(false);
  const face = "absolute inset-0 h-full w-full rounded-2xl ring-1 ring-black/10 [backface-visibility:hidden] motion-reduce:[backface-visibility:visible]";
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => setBack((b) => !b)}
        aria-pressed={back}
        aria-label={`${L.flip} — ${back ? L.back : L.front}`}
        className="group relative mx-auto aspect-[1276/2022] w-full max-w-sm cursor-pointer rounded-2xl outline-none [perspective:1600px] focus-visible:ring-2 focus-visible:ring-black/40"
      >
        <span
          className={`absolute inset-0 block transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none ${
            back ? "[transform:rotateY(180deg)] motion-reduce:[transform:none]" : ""
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- صورةٌ مولَّدةٌ على الخادم بمقاسها */}
          <img src={frontUrl} alt={L.alt} width={1276} height={2022} className={`${face} ${back ? "motion-reduce:hidden" : ""}`} />
          {/* eslint-disable-next-line @next/next/no-img-element -- الوجهُ الخلفي المعتمد */}
          <img
            src={backUrl}
            alt={`${L.alt} — ${L.back}`}
            width={1276}
            height={2022}
            loading="lazy"
            className={`${face} [transform:rotateY(180deg)] motion-reduce:[transform:none] ${back ? "" : "motion-reduce:hidden"}`}
          />
        </span>
      </button>
      <span className="text-xs text-black/50" aria-live="polite">
        {back ? L.back : L.front} · {L.flip}
      </span>
    </div>
  );
}
