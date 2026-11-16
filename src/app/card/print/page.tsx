import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDictionary, getLocale } from "@/i18n/server";
import { shareCardUrl, type BannerSubject } from "@/lib/bannerToken";
import { businessCardData } from "@/lib/businessCardData";
import { MY_CARD_READY } from "@/components/MyMembershipCard";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** **طباعةُ البطاقة بالوجهين** (البند ٥) — لصاحبها وحده بجلسته، ووجهاها من المسار الموقَّع نفسه.
 *  - **«على الوجهين»** (الافتراضي): صفحتان بمقاس البطاقة الدقيق 54×85.6 مم — الأمامي ثم الخلفي — لطابعةٍ تطبع على
 *    الوجهين بالقلب على الحافة الطويلة.
 *  - **«ورقة A4»**: الوجهان جنباً إلى جنب بمقاسهما الحقيقي مع علامات قصّ، وتعليماتٌ للطباعة اليدوية.
 *  ولا يُطبع من الصفحة إلا البطاقة: التعليماتُ والأزرارُ للشاشة وحدها. */
export default async function CardPrintPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fcard%2Fprint");
  const home = session.user.role === "member" ? "/member" : "/admin/profile";
  if (!MY_CARD_READY) redirect(home);
  const T = getDictionary(await getLocale()).cardPrint;
  const subject: BannerSubject = { kind: session.user.role === "member" ? "member" : "user", id: session.user.id };
  const card = await businessCardData(subject);
  if (!card) redirect(home);
  const front = shareCardUrl("business", subject, "", card.version);
  const back = `${front}&side=back`;
  const sheet = (await searchParams).mode === "sheet";

  const css = sheet
    ? `@page { size: A4 portrait; margin: 12mm; }
       .sheet { display:flex; gap:12mm; justify-content:center; padding-top:8mm; }
       .cut { position:relative; width:54mm; height:85.6mm; }
       .cut img { width:54mm; height:85.6mm; display:block; }
       .cut::before, .cut::after { content:""; position:absolute; inset:-4mm; border:0.2mm dashed #888; pointer-events:none; }
       .cut::after { inset:0; border:0.1mm solid #bbb; }`
    : `@page { size: 54mm 85.6mm; margin: 0; }
       .face { width:54mm; height:85.6mm; margin:0 auto 6mm; }
       .face img { width:54mm; height:85.6mm; display:block; }
       @media print { .face { margin:0; break-after:page; page-break-after:always; } .face:last-child { break-after:auto; page-break-after:auto; } }`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 print:p-0">
      <style>{`${css}
        @media print { .no-print { display:none !important; } html, body { background:#fff !important; } * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }`}</style>
      <section className="no-print flex flex-col gap-3">
        <h1 className="text-lg font-bold">{sheet ? T.sheetTitle : T.duplexTitle}</h1>
        <ol className="list-decimal space-y-1.5 ps-5 text-sm leading-relaxed text-black/70">
          {(sheet ? T.sheetSteps : T.duplexSteps).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <PrintButton label={T.print} />
          <Link href={sheet ? "/card/print" : "/card/print?mode=sheet"} className="text-sm font-semibold underline">
            {sheet ? T.switchDuplex : T.switchSheet}
          </Link>
          <Link href={home} className="text-sm text-black/55 underline">
            {T.back}
          </Link>
        </div>
      </section>
      {sheet ? (
        <div className="sheet">
          <div className="cut">
            {/* eslint-disable-next-line @next/next/no-img-element -- صورةٌ مولَّدةٌ على الخادم بمقاس الطباعة */}
            <img src={front} alt={T.front} />
          </div>
          <div className="cut">
            {/* eslint-disable-next-line @next/next/no-img-element -- الوجهُ الخلفي المعتمد */}
            <img src={back} alt={T.backFace} />
          </div>
        </div>
      ) : (
        <div>
          <div className="face">
            {/* eslint-disable-next-line @next/next/no-img-element -- صورةٌ مولَّدةٌ على الخادم بمقاس الطباعة */}
            <img src={front} alt={T.front} />
          </div>
          <div className="face">
            {/* eslint-disable-next-line @next/next/no-img-element -- الوجهُ الخلفي المعتمد */}
            <img src={back} alt={T.backFace} />
          </div>
        </div>
      )}
    </main>
  );
}
