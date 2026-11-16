import Link from "next/link";
import { Card } from "@/components/ui";
import { CardFlip } from "@/components/CardFlip";
import type { themeFromColor } from "@/lib/brand";

/** «بطاقتي» لكل حساب — العضو في صفحته، والمؤسسُ والإدارةُ العليا والقادةُ في «بياناتي».
 *  اعتمد المؤسس تصميمَها (البطاقةُ الرسمية CR80 بالصورة الشخصية، نوفمبر 2026) — و`false` يُعيدها «قريباً» للجميع */
export const MY_CARD_READY = true;

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
  L: {
    title: string;
    hint: string;
    save: string;
    alt: string;
    soon: string;
    soonHint: string;
    flip: string;
    front: string;
    back: string;
    print: string;
    printSheet: string;
  };
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
      {/* **وجهان يُقلبان** (البند ٥) — الخلفيُّ من المسار الموقَّع نفسه (`?side=back`) */}
      <CardFlip frontUrl={url} backUrl={`${url}${url.includes("?") ? "&" : "?"}side=back`} L={{ alt: L.alt, flip: L.flip, front: L.front, back: L.back }} />
      <div className="flex flex-wrap items-center justify-center gap-2">
      <a
        href={`${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(fileName)}`}
        download={`${fileName}.png`}
        className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold hover:brightness-95"
        style={{ background: theme.fill, color: theme.onFill }}
      >
        {L.save}
      </a>
      <Link href="/card/print" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/15 px-5 text-sm font-semibold hover:bg-black/[0.04]">
        {L.print}
      </Link>
      <Link href="/card/print?mode=sheet" className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm text-black/60 underline">
        {L.printSheet}
      </Link>
      </div>
    </Card>
  );
}
