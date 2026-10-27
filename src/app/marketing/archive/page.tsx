import Link from "next/link";
import { marketingPage } from "@/lib/marketing/page";
import { searchArchive } from "@/lib/marketing/archive";
import { CONTENT_TYPES } from "@/lib/marketing/schedule";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "../_components/MkHeader";
import { Section, Field, inputCls, Muted, when, Pager } from "../_components/bits";

export const dynamic = "force-dynamic";

/** البحثُ والتصفّحُ في أرشيف الحملات — من ملف أرشيف التسويق المستقل مباشرةً، عند الطلب وحده.
 *
 *  لا يُقرأ الملفُّ بفتح الصفحة: يبدأ البحثُ (أو «تصفّح الكل») بإرسال النموذج، ويقرأ تبويبَ «فهرس
 *  الحملات» وحده بأعمدته الأولى، ويعرض صفحاتٍ من عشرين، ولا يخزّن شيئاً يُعرض لاحقاً كأنه حديث.
 *  والصلاحيةُ في الخادم (`searchArchive`). */
export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor, mk, isManager, canArchive } = await marketingPage("/marketing/archive");
  const L = mk.archive;
  const asked = sp.q === "1";
  const query = { text: sp.text, from: sp.from, to: sp.to, platform: sp.platform, contentType: sp.contentType };
  const result = asked && canArchive ? await searchArchive(actor, { ...query, page: Number(sp.p) || 1 }) : null;
  const pageHref = (n: number) => `/marketing/archive?${new URLSearchParams({ q: "1", ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)), p: String(n) } as Record<string, string>)}`;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader mk={mk} current="archive" isManager={isManager} canArchive={canArchive} title={L.title} description={L.hint} />
      {!canArchive ? (
        <Muted>{L.forbidden}</Muted>
      ) : (
        <>
          <Section title={L.search}>
            <form method="get" className="grid gap-3 sm:grid-cols-5">
              <input type="hidden" name="q" value="1" />
              <Field label={L.text} className="sm:col-span-2">
                <input name="text" defaultValue={sp.text ?? ""} maxLength={160} className={inputCls} dir="auto" />
              </Field>
              <Field label={L.from}>
                <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputCls} />
              </Field>
              <Field label={L.to}>
                <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputCls} />
              </Field>
              <Field label={L.platform}>
                <input name="platform" defaultValue={sp.platform ?? ""} maxLength={40} dir="ltr" className={inputCls} />
              </Field>
              <Field label={L.contentType}>
                <select name="contentType" defaultValue={sp.contentType ?? ""} className={inputCls}>
                  <option value="">{L.any}</option>
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>{mk.calendar.contentTypes[t]}</option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-wrap items-end gap-2 sm:col-span-4">
                <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/15 px-4 text-sm font-bold hover:bg-black/[0.04]">{L.search}</button>
                <Link href="/marketing/archive?q=1" prefetch={false} className="inline-flex min-h-10 items-center justify-center rounded-xl px-3 text-sm font-bold text-black/60 hover:bg-black/[0.04]">{L.browse}</Link>
              </div>
            </form>
          </Section>
          {result && (
            <Section title={result.ok ? fmt(L.results, result.total) : L.search} hint={result.ok ? fmt(L.readAt, when(result.readAt)) : undefined}>
              {!result.ok ? (
                <p className="text-sm text-red-800">{result.code === "archive_unavailable" ? L.unavailable : mk.errors.unknown}</p>
              ) : result.results.length === 0 ? (
                <Muted>{L.none}</Muted>
              ) : (
                <ul className="flex flex-col gap-2">
                  {result.results.map((r) => (
                    <li key={r.campaignId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-black/[0.08] p-3 text-sm">
                      <span className="font-bold" dir="auto">{r.name}</span>
                      <span className="text-xs text-black/60">{L.period}: {r.start || "—"} — {r.end || "—"}</span>
                      <span className="text-xs text-black/60">{L.pieces}: {r.pieces} · {L.published}: {r.published}</span>
                      <span className="text-xs text-black/60" dir="ltr">{r.platforms.join(", ")}</span>
                      {r.plan && <span className="text-xs text-black/60" dir="auto">{r.plan}</span>}
                      <Link href={`/marketing/archive/${encodeURIComponent(r.campaignId)}`} className="text-xs font-bold underline-offset-2 hover:underline" prefetch={false}>{L.open}</Link>
                    </li>
                  ))}
                </ul>
              )}
              {result.ok && (
                <div className="mt-3">
                  <Pager page={result.page} pages={result.pages} href={pageHref} labels={mk.common} />
                </div>
              )}
            </Section>
          )}
          <p className="text-[11px] leading-relaxed text-black/50">{L.noRestore} {L.filesNote}</p>
        </>
      )}
    </main>
  );
}
