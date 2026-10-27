import Link from "next/link";
import { marketingPage } from "@/lib/marketing/page";
import { archivedCampaign } from "@/lib/marketing/archive";
import { ARCHIVE_TABS } from "@/lib/marketing/archiveLayout";
import { fmt } from "@/i18n/fmt";
import { MkHeader } from "../../_components/MkHeader";
import { Section, Muted, when } from "../../_components/bits";

export const dynamic = "force-dynamic";

/** حملةٌ مؤرشفة — صفوفُها من ملف الأرشيف كما هي، تبويباً تبويباً بترتيب الملف. للعرض وحده: لا تُنشأ بها حملةٌ نشطة. */
export default async function ArchivedCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaignId = decodeURIComponent(id);
  const { actor, mk, isManager, canArchive } = await marketingPage(`/marketing/archive/${id}`);
  const L = mk.archive;
  const res = canArchive ? await archivedCampaign(actor, campaignId) : null;
  const rows = res && res.ok ? res.rows : [];
  const head = rows.find((r) => r.type === "campaign");
  const groups = ARCHIVE_TABS.map((t) => t.id).filter((t) => rows.some((r) => r.tab === t));
  const typeLabel = (t: string) => (L.types as Record<string, string>)[t] ?? t;
  // في «فهرس الحملات» العمودان عددان (القطع والمنشور منها) لا موعدان — يُعرض التاريخُ تاريخاً وحده
  const cell = (v: string) => (/^\d{4}-\d{2}-\d{2}T/.test(v) ? when(v) : v);
  const C = L.columns;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <MkHeader
        mk={mk}
        current={null}
        isManager={isManager}
        canArchive={canArchive}
        title={head?.name ?? L.detailTitle}
        description={head ? `${L.period}: ${head.start || "—"} — ${head.end || "—"}` : undefined}
        back={<Link href="/marketing/archive" className="text-xs font-bold text-black/55 hover:underline">{L.title}</Link>}
      />
      {!canArchive ? (
        <Muted>{L.forbidden}</Muted>
      ) : !res || !res.ok ? (
        <p className="text-sm text-red-800">{res && !res.ok && res.code === "archive_unavailable" ? L.unavailable : mk.errors.not_found}</p>
      ) : (
        <>
          <p className="text-xs text-black/55">{fmt(L.readAt, when(res.readAt))} · {L.noRestore}</p>
          {groups.map((t) => (
            <Section key={t} title={`${(L.tabs as Record<string, string>)[t] ?? t} (${rows.filter((r) => r.tab === t).length})`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-start text-xs">
                  <thead className="text-black/55">
                    <tr>
                      {[C.type, C.item, C.status, C.planned, C.actual, C.person, C.result, C.link].map((h) => (
                        <th key={h} className="px-2 py-1 text-start font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.filter((r) => r.tab === t).slice(0, 200).map((r) => (
                      <tr key={r.key} className="border-t border-black/[0.06] align-top">
                        <td className="px-2 py-1.5 text-black/55">{typeLabel(r.type)}</td>
                        <td className="px-2 py-1.5" dir="auto">{r.item}</td>
                        <td className="px-2 py-1.5" dir="auto">{r.status}</td>
                        <td className="px-2 py-1.5">{cell(r.planned)}</td>
                        <td className="px-2 py-1.5">{cell(r.actual)}</td>
                        <td className="px-2 py-1.5" dir="auto">{r.person}</td>
                        <td className="px-2 py-1.5" dir="auto">{r.result}</td>
                        <td className="px-2 py-1.5" dir="ltr">
                          {/* الشيتُ يُعدَّل بأيدٍ أخرى: يُرسم رابطاً ما كان https وحده، وغيرُه نصّاً */}
                          {r.link && /^https:\/\//i.test(r.link) ? (
                            <a href={r.link} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{r.link}</a>
                          ) : (
                            r.link
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ))}
          <p className="text-[11px] leading-relaxed text-black/50">{L.filesNote}</p>
        </>
      )}
    </main>
  );
}
