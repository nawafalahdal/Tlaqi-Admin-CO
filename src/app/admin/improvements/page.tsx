import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { auth } from "@/auth";
import { Card } from "@/components/ui";
import {
  improvementInbox,
  myImprovements,
  canTriage,
  readContext,
} from "@/lib/improvements";
import { ImprovementRow } from "./ImprovementRow";
import { ConfirmFix } from "./ConfirmFix";

import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
export const dynamic = "force-dynamic";

/** صندوقُ التحسين — ما بَلَغ المنصةَ من ملاحظات، وما ينتظر صاحبَه.
 *
 *  **وصفحةٌ واحدة لا صفحتان:** من يُقرّر يَرى الصندوقَ وملاحظاتِه معاً،
 *  ومن لا يُقرّر يَرى ملاحظاتِه وحدها. ولو فُصلتا لصار على المؤسس أن
 *  يَتجوّل بين شاشتين ليَعرف ماذا ينتظره.
 */
export default async function ImprovementsPage() {
  const locale = await getLocale();
  const L = getDictionary(locale).rImprPage;
  const labels = getDictionary(locale).libLabels;
  const session = await auth();
  if (!session) redirect("/login");

  const triage = canTriage(session.user.role);
  const [inbox, mine] = await Promise.all([
    triage ? improvementInbox() : Promise.resolve([]),
    myImprovements(session),
  ]);

  const awaitingMe = mine.filter((t) => t.improvementState === "awaiting_user");

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={L.improvementCentre} description={<>{L.everyNoteRaisedFrom}</>} />

        {/* ينتظر شهادتَك — يتصدّر، فهو عملٌ عليك أنت */}
        {awaitingMe.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-bold">{L.awaitingYourTry}</h2>
            <ul className="flex flex-col gap-3">
              {awaitingMe.map((t) => (
                <li key={t.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                        #{t.ticketNumber}
                      </span>
                      <span className="text-sm font-bold">{t.subject}</span>
                    </div>
                    {t.resolutionNote && (
                      <p className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/65">
                        {fmt(L.whatWasSaidAbout, t.resolutionNote)}</p>
                    )}
                    <ConfirmFix ticketId={t.id} />
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* الصندوق — لمن يُقرّر */}
        {triage && (
          <section>
            <h2 className="mb-3 text-base font-bold">{L.inbox}{" "}
              <span className="text-sm font-semibold text-black/45">({inbox.length})</span>
            </h2>
            {inbox.length === 0 ? (
              <Card className="p-6 text-center text-sm text-black/45">{L.noOpenNotesAn}</Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {inbox.map((t) => {
                  const ctx = readContext(t.pageContext);
                  return (
                    <li key={t.id}>
                      <Card className="p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-black/[0.07] px-2 py-0.5 text-[11px] font-bold text-black/60">
                            #{t.ticketNumber}
                          </span>
                          <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-bold text-black/55">
                            {t.improvementKind ? labels.improvementKind[t.improvementKind] : "—"}
                          </span>
                          <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-bold text-black/55">
                            {t.improvementState ? labels.improvementState[t.improvementState] : "—"}
                          </span>
                          <span className="text-sm font-bold">{t.subject}</span>
                        </div>

                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/70">
                          {t.description}
                        </p>

                        {/* السياقُ الملتقَط: المسارُ أهمُّه — به تُعاد المعاينة */}
                        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-black/40">
                          <span>
                            {fmt(L.raisedBy, t.member?.fullName ?? t.raisedByUser?.fullName ?? "—")}</span>
                          {ctx.path && <span dir="ltr">{fmt(L.page, ctx.path)}</span>}
                          {ctx.viewport && <span dir="ltr">{fmt(L.size, ctx.viewport)}</span>}
                          {ctx.theme && <span>{L.theme}{ctx.theme === "dark" ? L.dark : L.light}</span>}
                          {ctx.locale && <span dir="ltr">{ctx.locale}</span>}
                        </p>

                        {t.userRejectedAt && (
                          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{L.itsAuthorTriedIt}</p>
                        )}

                        <ImprovementRow
                          ticketId={t.id}
                          state={t.improvementState ?? "new"}
                          kind={t.improvementKind ?? "bug"}
                        />
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* ملاحظاتي — لكلّ أحد */}
        <section>
          <h2 className="mb-3 text-base font-bold">{L.myNotes}</h2>
          {mine.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">{L.youHaveNotRaised}</Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {mine.map((t) => (
                <li key={t.id}>
                  <Card className="p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-black/[0.07] px-2 py-0.5 text-[11px] font-bold text-black/60">
                        #{t.ticketNumber}
                      </span>
                      <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-bold text-black/55">
                        {t.improvementState ? labels.improvementState[t.improvementState] : "—"}
                      </span>
                      <span className="text-sm font-bold">{t.subject}</span>
                    </div>
                    {t.resolutionNote && (
                      <p className="mt-1.5 text-xs leading-relaxed text-black/50">
                        {t.resolutionNote}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
