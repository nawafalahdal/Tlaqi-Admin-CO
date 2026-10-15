import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { themeFromColor, SUPER_ADMIN_THEME, BRAND } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { readPlanLibrary, canManagePlans, humanSize, typeLabel } from "@/lib/plans";
import { formatDate } from "@/lib/format";
import { PlanIntroEditor } from "./PlanIntroEditor";
import { PlanDocManager } from "./PlanDocManager";
import { AddPlanDoc } from "./AddPlanDoc";

export const dynamic = "force-dynamic";

/** مركزُ خطط تَـــلاقِ — نبذةٌ يقرؤها الجميع، ثم الوثائق مرقَّمةً.
 *
 *  **يراها كلُّ من يدخل المنصة:** العضوُ كالقائد كالمؤسس. فالخطةُ لا
 *  تُكتَب ليحرسها كاتبُها — تُكتَب ليَعرفها من يُنفّذها. أما الكتابةُ
 *  فللمؤسس والمدير التنفيذي وحدهما.
 *
 *  **والترتيبُ مقصودٌ ويُقرأ رقماً:** الرقمُ الكبيرُ على يمين كل مادة
 *  ليس زينة — هو ما يجعل «اقرأ الأولى ثم الثانية» جملةً مفهومة. ومن
 *  يملك المركز يُبدّل الترتيب بسهمَين، فلا يُعاد الرفعُ لتُقدَّم وثيقة.
 */
export default async function PlansPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { heading, intro, updatedByName, updatedAt, docs } = await readPlanLibrary();
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const isMember = session.user.role === "member";
  const canManage = canManagePlans(session.user.role);

  return (
    <div className="min-h-screen bg-page">
      <AppHeader
        theme={theme}
        roleName="مركز الخطط"
        userName={session.user.name ?? ""}
        homeHref={isMember ? "/member" : "/admin"}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-5 sm:py-8">
        <BackButton fallbackHref={isMember ? "/member" : "/admin"} />

        {/* ── الواجهة: الشعارُ والعنوانُ والنبذة في لوحةٍ واحدةٍ بالهوية.
            وهي أولُ ما يُقرأ عمداً: من دخل يعرف ما هي تَـــلاقِ ولماذا،
            قبل أن يُفتَح له ملف. */}
        <section
          className="overflow-hidden rounded-3xl"
          style={{
            background: `linear-gradient(140deg, ${BRAND.temptress} 0%, #4A2B3C 55%, ${BRAND.mahogany} 100%)`,
          }}
        >
          <div className="px-5 py-7 sm:px-8 sm:py-10">
            <span
              className="inline-block rounded-full px-3 py-1 text-[11px] font-bold"
              style={{ background: "#FFFFFF22", color: BRAND.beige }}
            >
              وثائق التوجّه — للجميع
            </span>
            <h1 className="mt-3 text-xl font-bold sm:text-2xl" style={{ color: BRAND.beige }}>
              {heading}
            </h1>
            {intro.trim() ? (
              <div
                className="mt-4 flex flex-col gap-2.5 text-sm leading-relaxed sm:text-[15px]"
                style={{ color: "#FFFFFFDD" }}
              >
                {/* النصُّ يُعرَض فقراتٍ كما كُتب: الأسطرُ الفارغة تفصل.
                    ولا HTML من المُدخَل — يُعرَض نصّاً فيُؤمَن ويُقرأ. */}
                {intro
                  .split(/\n\s*\n/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
              </div>
            ) : (
              <p className="mt-4 text-sm" style={{ color: "#FFFFFFAA" }}>
                {canManage
                  ? "لم تُكتب النبذة بعد — اكتبها من «تحرير النبذة» أسفل الصفحة: من نحن، ولماذا، وكيف."
                  : "النبذة لم تُكتب بعد."}
              </p>
            )}
            {updatedAt && (
              <p className="mt-5 text-[11px]" style={{ color: "#FFFFFF88" }}>
                آخر تحديث {formatDate(updatedAt)}
                {updatedByName ? ` — ${updatedByName}` : ""}
              </p>
            )}
          </div>
        </section>

        {/* ── الوثائق: مرقَّمةٌ بالترتيب المقصود */}
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold">الوثائق والملفات ({docs.length})</h2>
            <p className="text-xs text-black/45">
              بالترتيب الذي رتّبته الإدارة — اقرأها من الأولى
            </p>
          </div>

          {docs.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/45">
              لا وثائق بعد.
              {canManage ? " أضف أولَ وثيقةٍ من النموذج أسفل الصفحة." : ""}
            </Card>
          ) : (
            <ol className="flex flex-col gap-3">
              {docs.map((d, index) => (
                <li key={d.id}>
                  <Card className="p-4">
                    <div className="flex items-start gap-3.5">
                      {/* الرقمُ كبيرٌ مقصود: هو الترتيب نفسُه لا زينة */}
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-base font-bold tabular-nums"
                        style={{
                          background: `${BRAND.mahogany}14`,
                          color: `light-dark(${BRAND.mahogany}, var(--ink))`,
                          border: `1px solid ${BRAND.mahogany}33`,
                        }}
                        aria-hidden
                      >
                        {index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold leading-snug">{d.title}</h3>
                        {d.note && (
                          <p className="mt-1 text-xs leading-relaxed text-black/55">{d.note}</p>
                        )}
                        <p className="mt-1.5 text-[11px] text-black/40">
                          {d.kind === "file"
                            ? `${typeLabel(d.mimeType)} · ${humanSize(d.byteSize)}`
                            : "رابط خارجي"}
                          {" · أضافها "}
                          {d.uploadedByName} · {formatDate(d.createdAt)}
                        </p>
                      </div>

                      {/* الفتحُ مباشرٌ: زرٌّ واحدٌ واضحٌ لا قائمةُ خيارات */}
                      <a
                        href={d.kind === "file" ? `/api/plans/${d.id}/file` : (d.linkUrl ?? "#")}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold text-on-brand transition-opacity hover:opacity-90"
                        style={{ background: BRAND.mahogany }}
                      >
                        {d.kind === "file" ? "افتح الملف" : "افتح الرابط"}
                      </a>
                    </div>

                    {canManage && (
                      <PlanDocManager
                        docId={d.id}
                        title={d.title}
                        note={d.note}
                        isFirst={index === 0}
                        isLast={index === docs.length - 1}
                        theme={theme}
                      />
                    )}
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ── أدواتُ من يملك المركز: المؤسس والتنفيذي */}
        {canManage && (
          <section className="mt-8 flex flex-col gap-4">
            <h2 className="text-base font-bold">إدارة المركز</h2>
            <Card className="p-4 sm:p-5">
              <AddPlanDoc theme={theme} />
            </Card>
            <Card className="p-4 sm:p-5">
              <PlanIntroEditor heading={heading} intro={intro} theme={theme} />
            </Card>
            <Card className="p-4 text-xs leading-relaxed text-black/50">
              الكتابةُ هنا لك وللمدير التنفيذي وحدكما، والقراءةُ لكل من يدخل المنصة — عضواً كان أو
              قائداً. وكلُّ إضافةٍ أو حذفٍ يُكتَب في السجل الحيّ باسم صاحبه.
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}
