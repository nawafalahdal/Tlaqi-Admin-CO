import Link from "next/link";
import { marketingPage } from "@/lib/marketing/page";
import { archivedCampaign } from "@/lib/marketing/archive";
import { ARCHIVE_TABS, INDEX_TAB } from "@/lib/marketing/archiveLayout";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "../../_components/MkHeader";
import { Section, Muted, when } from "../../_components/bits";

export const dynamic = "force-dynamic";

/** حملةٌ مؤرشفة — صفوفُها من ملف الأرشيف كما هي، تبويباً تبويباً بترتيب الملف. للعرض وحده: لا تُنشأ بها حملةٌ نشطة. */
export default async function ArchivedCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaignId = decodeURIComponent(id);
  const { actor, mk, isManager, canArchive, work, notices } = await marketingPage(`/marketing/archive/${id}`);
  const L = mk.archive;
  const res = canArchive ? await archivedCampaign(actor, campaignId) : null;
  const rows = res && res.ok ? res.rows : [];
  const head = rows.find((r) => r.type === "campaign");
  const groups = ARCHIVE_TABS.filter((t) => rows.some((r) => r.tab === t.id));
  const typeLabel = (t: string) => (L.types as Record<string, string>)[t] ?? t;
  const cell = (v: string) => (/^\d{4}-\d{2}-\d{2}T/.test(v) ? when(v) : v);
  // الأعمدةُ التقنية (المفاتيح، والحملةُ نفسها في كل صف، والتفاصيلُ الخام) لا تُعرض — والملفُّ يحفظها
  const HIDDEN = new Set(["key", "campaignId", "campaign", "start", "end", "details", "archivedAt", "runId"]);
  const LINKS = new Set(["link", "designLink", "postUrl"]);
  const nameOf = head ? head.cells[INDEX_TAB.at.name] : null;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current={null}
        isManager={isManager}
        canArchive={canArchive} work={work} notices={notices}
        title={nameOf ?? L.detailTitle}
        description={head ? `${L.period}: ${head.cells[INDEX_TAB.at.start] || "—"} — ${head.cells[INDEX_TAB.at.end] || "—"}` : undefined}
        back={<Link href="/marketing/archive" className="text-xs font-bold text-black/55 hover:underline">{L.title}</Link>}
      />
      {!canArchive ? (
        <Muted>{L.forbidden}</Muted>
      ) : !res || !res.ok ? (
        <p className="text-sm text-red-800">{res && !res.ok && res.code === "archive_unavailable" ? L.unavailable : mk.errors.not_found}</p>
      ) : (
        <>
          <p className="text-xs text-black/55">{fmt(L.readAt, when(res.readAt))} · {L.noRestore}</p>
          <p className="text-[11px] text-black/50">{L.headersFromFile}</p>
          {groups.map((t) => {
            const shown = t.columns.map((c, i) => ({ ...c, i })).filter((c) => !HIDDEN.has(c.id));
            const list = rows.filter((r) => r.tab === t.id);
            return (
              <Section key={t.id} title={`${(L.tabs as Record<string, string>)[t.id] ?? t.name} (${list.length})`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-start text-xs">
                    <thead className="text-black/55">
                      <tr>
                        {shown.map((c) => (
                          <th key={c.id} className="px-2 py-1 text-start font-bold" dir="auto">{c.id === "type" ? L.columns.type : c.header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.slice(0, 200).map((r) => (
                        <tr key={r.key} className="border-t border-black/[0.06] align-top">
                          {shown.map((c) => {
                            const v = r.cells[c.i] ?? "";
                            if (c.id === "type") return <td key={c.id} className="px-2 py-1.5 text-black/55">{typeLabel(v)}</td>;
                            if (LINKS.has(c.id)) {
                              return (
                                <td key={c.id} className="px-2 py-1.5" dir="ltr">
                                  {/* الشيتُ يُعدَّل بأيدٍ أخرى: يُرسم رابطاً ما كان https وحده، وغيرُه نصّاً */}
                                  {/^https:\/\//i.test(v) ? <a href={v} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{v}</a> : v}
                                </td>
                              );
                            }
                            return (
                              <td key={c.id} className={`px-2 py-1.5 ${c.wrap ? "max-w-[22rem] whitespace-pre-wrap" : ""}`} dir="auto">
                                {c.wrap && v.length > 600 ? `${v.slice(0, 600)}…` : cell(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            );
          })}
          <p className="text-[11px] leading-relaxed text-black/50">{L.filesNote}</p>
        </>
      )}
    </main>
  );
}
