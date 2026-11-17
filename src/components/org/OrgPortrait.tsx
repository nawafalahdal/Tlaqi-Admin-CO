import type { CSSProperties } from "react";
import type { Portrait } from "@/lib/portrait";

/** **صورةُ الشخص في الهيكل** — الصورةُ عنصرُ التصميم الأول (طلب المؤسس، نوفمبر 2026):
 *  - **بلا إطارٍ مستطيلٍ صلب:** قوسٌ علويٌّ ناعم يحتضن الصورة، وتوهّجٌ خفيفٌ خلفها يدمجها بالخلفية — لا ملصقٌ منفصل.
 *  - **تلاشٍ تدريجيٌّ من الأسفل (Bottom Fade)** بقناع CSS (`mask-image`، ومعه `-webkit-` لسفاري): يبدأ أسفلَ الكتفين ويذوب
 *    في خلفية العنصر نفسها أيّاً كانت — فلا حدَّ قصٍّ ظاهر. والاسمُ والمنصبُ تحت الصورة لا عليها، فلا يغطّيهما التلاشي.
 *  - **بلا تشويه ولا قصٍّ للرأس:** نسبةٌ ثابتة 4:5؛ الصورةُ المرفوعة (مربّعٌ موحَّد عند الرفع) تملأ الإطار من أعلاه
 *    (`object-top`)، والهيئتان الافتراضيتان الرسميتان (شفّافتان كاملتا الهيئة) تُعرضان كاملتين (`contain`) على أساس الإطار.
 *  - **تحميلٌ كسول** إلا لمن في القمة، والرابطُ الواحد للهيئة الافتراضية يُحمَّل مرّةً ويُعاد من ذاكرة المتصفح. */

const W = { xl: 176, lg: 148, md: 116, sm: 84 } as const;
export type PortraitSize = keyof typeof W;

const FADE = "linear-gradient(to bottom, #000 0%, #000 56%, rgba(0,0,0,0.55) 76%, transparent 97%)";
const fade: CSSProperties = { WebkitMaskImage: FADE, maskImage: FADE };

export function OrgPortrait({ portrait, size, eager = false, highlight = false }: { portrait: Portrait; size: PortraitSize; eager?: boolean; highlight?: boolean }) {
  const w = W[size];
  const h = Math.round((w * 5) / 4);
  return (
    <span aria-hidden="true" className="relative block shrink-0" style={{ width: w, height: h }}>
      {/* توهّجٌ خلف الهيئة يدمجها بالخلفية — لا إطار */}
      <span
        className="absolute inset-x-[6%] bottom-[4%] top-[18%] rounded-[50%]"
        style={{ background: `radial-gradient(closest-side, ${highlight ? "rgba(195,73,0,0.38)" : "rgba(238,246,223,0.13)"}, transparent)` }}
      />
      <span className="absolute inset-0 overflow-hidden" style={{ borderRadius: `${w / 2}px ${w / 2}px 0 0`, ...fade }}>
        {portrait.kind === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element -- مسارٌ داخليٌّ مخزَّن بختمٍ ثابت (`/api/avatar`)
          <img src={portrait.src} alt="" width={w} height={h} loading={eager ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover object-top" />
        ) : portrait.kind === "default" ? (
          // eslint-disable-next-line @next/next/no-img-element -- الهيئةُ الافتراضيةُ الرسميةُ نفسُها في البطاقة
          <img src={portrait.src} alt="" width={w} height={h} loading={eager ? "eager" : "lazy"} decoding="async" className="h-full w-full object-contain object-bottom" />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-bold text-[#EEF6DF]"
            style={{ fontSize: Math.round(w * 0.3), background: "linear-gradient(180deg, rgba(238,246,223,0.16), rgba(238,246,223,0.04))" }}
          >
            {portrait.text}
          </span>
        )}
      </span>
    </span>
  );
}

/** وجهٌ صغيرٌ دائري — لصفّ وجوه أعضاء اللجنة وحده (ليس بطاقةً للشخص) */
export function OrgFace({ portrait, px = 30 }: { portrait: Portrait; px?: number }) {
  return (
    <span aria-hidden="true" className="relative block shrink-0 overflow-hidden rounded-full bg-[#4A2A3E] ring-2 ring-[#2E1926]" style={{ width: px, height: px }}>
      {portrait.kind === "initials" ? (
        <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-[#EEF6DF]">{portrait.text}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- الصورةُ نفسُها من مصدرها الواحد
        <img src={portrait.src} alt="" width={px} height={px} loading="lazy" decoding="async" className={`h-full w-full ${portrait.kind === "photo" ? "object-cover object-top" : "object-cover object-[50%_18%] scale-[1.35]"}`} />
      )}
    </span>
  );
}

/** مقعدٌ شاغر — يُعلَن ولا يُسنَد إلى أحد */
export function VacantPortrait({ size }: { size: PortraitSize }) {
  const w = W[size];
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 border border-dashed border-[#EEF6DF]/25"
      style={{ width: w, height: Math.round((w * 5) / 4), borderRadius: `${w / 2}px ${w / 2}px 0 0`, WebkitMaskImage: FADE, maskImage: FADE, background: "linear-gradient(180deg, rgba(238,246,223,0.06), transparent)" }}
    />
  );
}
