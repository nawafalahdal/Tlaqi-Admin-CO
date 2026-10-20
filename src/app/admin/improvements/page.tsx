import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import {
  improvementInbox,
  myImprovements,
  canTriage,
  STATE_LABEL,
  KIND_LABEL,
  readContext,
} from "@/lib/improvements";
import { ImprovementRow } from "./ImprovementRow";
import { ConfirmFix } from "./ConfirmFix";

export const dynamic = "force-dynamic";

/** صندوقُ التحسين — ما بَلَغ المنصةَ من ملاحظات، وما ينتظر صاحبَه.
 *
 *  **وصفحةٌ واحدة لا صفحتان:** من يُقرّر يَرى الصندوقَ وملاحظاتِه معاً،
 *  ومن لا يُقرّر يَرى ملاحظاتِه وحدها. ولو فُصلتا لصار على المؤسس أن
 *  يَتجوّل بين شاشتين ليَعرف ماذا ينتظره.
 */
export default async function ImprovementsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const triage = canTriage(session.user.role);
  const [inbox, mine] = await Promise.all([
    triage ? improvementInbox() : Promise.resolve([]),
    myImprovements(session),
  ]);

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const isMember = session.user.role === "member";
  const awaitingMe = mine.filter((t) => t.improvementState === "awaiting_user");

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName="مركز التحسين"
        userName={session.user.name ?? ""}
        homeHref={isMember ? "/member" : "/admin"}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <h1 className="text-lg font-bold sm:text-xl">مركزُ التحسين</h1>
          <p className="mt-1 text-sm leading-relaxed text-black/50">
            كلُّ ملاحظةٍ رُفعت من زرّ «تحسين» تصير تذكرةً هنا. ولا تُغلَق بإقرار من
            أنجزها وحده: من رفع الملاحظة هو من يؤكّد أنها أُنجزت.
          </p>
        </div>

        {/* ينتظر شهادتَك — يتصدّر، فهو عملٌ عليك أنت */}
        {awaitingMe.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-bold">ينتظر تجربتَك</h2>
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
                        ما قيل عن الإصلاح: {t.resolutionNote}
                      </p>
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
            <h2 className="mb-3 text-base font-bold">
              الصندوق{" "}
              <span className="text-sm font-semibold text-black/45">({inbox.length})</span>
            </h2>
            {inbox.length === 0 ? (
              <Card className="p-6 text-center text-sm text-black/45">
                لا ملاحظاتٍ قائمة. والصندوقُ الفارغُ خبرٌ حسن.
              </Card>
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
                            {t.improvementKind ? KIND_LABEL[t.improvementKind] : "—"}
                          </span>
                          <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-bold text-black/55">
                            {t.improvementState ? STATE_LABEL[t.improvementState] : "—"}
                          </span>
                          <span className="text-sm font-bold">{t.subject}</span>
                        </div>

                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/70">
                          {t.description}
                        </p>

                        {/* السياقُ الملتقَط: المسارُ أهمُّه — به تُعاد المعاينة */}
                        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-black/40">
                          <span>
                            رفعها: {t.member?.fullName ?? t.raisedByUser?.fullName ?? "—"}
                          </span>
                          {ctx.path && <span dir="ltr">الصفحة: {ctx.path}</span>}
                          {ctx.viewport && <span dir="ltr">المقاس: {ctx.viewport}</span>}
                          {ctx.theme && <span>السمة: {ctx.theme === "dark" ? "داكنة" : "فاتحة"}</span>}
                          {ctx.locale && <span dir="ltr">{ctx.locale}</span>}
                        </p>

                        {t.userRejectedAt && (
                          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                            جرّبها صاحبُها فوجدها كما كانت — عادت إلى العمل.
                          </p>
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
          <h2 className="mb-3 text-base font-bold">ملاحظاتي</h2>
          {mine.length === 0 ? (
            <Card className="p-6 text-center text-sm text-black/45">
              لم ترفع ملاحظةً بعد. والزرُّ في ترويسة كل شاشة.
            </Card>
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
                        {t.improvementState ? STATE_LABEL[t.improvementState] : "—"}
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
