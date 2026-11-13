import { Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** **«بطاقتي»** — بطاقةُ العضوية في صفحة صاحبها (قرار المؤسس، نوفمبر 2026).
 *
 *  لم تعد البطاقةُ تُرفق برسالة الاعتماد (الرسالةُ نصٌّ يُصوَّر ويُنشر)، فمكانُها هنا: يراها صاحبُها ويحفظها متى شاء.
 *  الصورةُ من مسارها الموقَّع (`/api/cards/welcome/…`) — لا تُرسم إلا بتوقيعٍ صادرٍ للحساب نفسه.
 *
 *  `card: null` ⇒ «قريباً»: البطاقةُ بانتظار تصميمها مع الصورة الشخصية (قرار المؤسس) — فلا تُعرض ولا تُحفظ. */
export function MyMembershipCard({
  card,
  theme,
  L,
}: {
  card: { url: string; fileName: string } | null;
  theme: ReturnType<typeof themeFromColor>;
  L: { title: string; hint: string; save: string; alt: string; soon: string; soonHint: string };
}) {
  if (!card) {
    return (
      <Card className="flex flex-col gap-1 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold">{L.title}</h2>
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ background: theme.fill, color: theme.onFill }}
          >
            {L.soon}
          </span>
        </div>
        <p className="text-xs text-black/50">{L.soonHint}</p>
      </Card>
    );
  }
  const { url, fileName } = card;
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-base font-bold">{L.title}</h2>
        <p className="mt-1 text-xs text-black/50">{L.hint}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- صورةٌ مولَّدةٌ على الخادم بمقاسها، لا تحتاج تحسين next/image */}
      <img
        src={url}
        alt={L.alt}
        width={1080}
        height={1350}
        className="mx-auto h-auto w-full max-w-sm rounded-2xl ring-1 ring-black/10"
      />
      <a
        href={`${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(fileName)}`}
        download={`${fileName}.png`}
        className="inline-flex min-h-11 items-center justify-center self-center rounded-xl px-5 text-sm font-semibold hover:brightness-95"
        style={{ background: theme.fill, color: theme.onFill }}
      >
        {L.save}
      </a>
    </Card>
  );
}
