import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/PageStates";
import { getLocale, getDictionary } from "@/i18n/server";
import { OFFICIAL_NOTICE_KINDS, NOTICE_LOG_LIMIT, SUPPRESSED_STATUS } from "@/lib/officialNotices";

export const dynamic = "force-dynamic";

/** سجلُّ التنبيهات — تنبيهاتُ صاحب الحساب وحده، والرسميُّ منها وحده.
 *
 *  كان «سجلُّ الرسائل الصادرة» يَعرض للمؤسس والتنفيذي كلَّ رسالةٍ خرجت لكل
 *  أحد. وقرارُ المؤسس: لكلٍّ تنبيهاتُه هو — ولا يرى أحدٌ تنبيهاتِ غيره.
 *  ثم قرارٌ ثانٍ: لا يكبر السجلُّ بلا حدّ، فيُعرَض المهمُّ الرسميّ وحده
 *  (`OFFICIAL_NOTICE_KINDS`)، وآخرُه لا كلُّه.
 *
 *  **والاستعلامُ على الفهرس.** كان يطابق البريدَ بلا حساسيةٍ لحالة الأحرف
 *  (`ILIKE`)، فيَقرأ الجدولَ كلَّه في كل فتحٍ للصفحة — وهو أكبرُ جداول
 *  المنصة نموّاً. والبريدُ مخزَّنٌ بأحرفٍ صغيرة (الدخولُ نفسُه يطابقه
 *  هكذا)، فتكفي المطابقةُ الدقيقة ويُقرأ فهرسُ `recipient` وحده. */
export default async function NotificationsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const email = session.user.email;
  if (!email) redirect("/login");

  const locale = await getLocale();
  const t = getDictionary(locale).notificationsPage;

  const logs = await prisma.emailLog.findMany({
    where: {
      recipient: { in: [...new Set([email, email.toLowerCase()])] },
      kind: { in: Object.keys(OFFICIAL_NOTICE_KINDS) },
      status: { not: SUPPRESSED_STATUS },
    },
    orderBy: { createdAt: "desc" },
    take: NOTICE_LOG_LIMIT,
    select: { id: true, kind: true, subject: true, status: true, createdAt: true },
  });

  // عنوانُ المرسِل وحده (لا الاسم) من الإعداد العلنيّ نفسه الذي يُرسل به البريد
  const fromSetting = process.env.EMAIL_FROM || "hello@tlaqiteam.site";
  const senderAddress = fromSetting.match(/<([^>]+)>/)?.[1] ?? fromSetting;
  const [spamBefore, spamAfter] = t.spamBody.split("{sender}");
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const tone = (s: string) =>
    s === "أُرسلت"
      ? { label: t.statusSent, cls: "bg-green-50 text-green-800" }
      : s === "فشل الإرسال"
        ? { label: t.statusFailed, cls: "bg-red-50 text-red-700" }
        : { label: t.statusDisabled, cls: "bg-amber-50 text-amber-900" };

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={t.title} description={t.description} />
        {/* أين تصل الرسائل، ومن أين تأتي — ليُنقَل المرسِلُ من «غير المرغوب» مرّةً
            فتصل بعدها في البريد الوارد دائماً. والمرسِلُ عنوانٌ معلَن لا سرّ */}
        <Card className="flex flex-col gap-3 p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold text-black/45">{t.deliveredTo}</p>
            <p className="mt-0.5 break-all text-sm font-bold" dir="ltr">
              {email}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900">
            <p className="font-bold">{t.spamTitle}</p>
            <p className="mt-1">
              {spamBefore}
              <span dir="ltr" className="font-bold">
                {senderAddress}
              </span>
              {spamAfter}
            </p>
          </div>
        </Card>

        <p className="text-xs leading-relaxed text-black/50">{t.scope.replace("{n}", String(NOTICE_LOG_LIMIT))}</p>

        {logs.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <Card className="divide-y divide-black/[0.06] p-0">
            {logs.map((l) => {
              const st = tone(l.status);
              const category = OFFICIAL_NOTICE_KINDS[l.kind];
              // أرقامٌ من ستّ خانات لا تُعرَض — احتياطاً لو دخل رمزٌ عنواناً يوماً
              const subject = l.subject.replace(/\b\d{6}\b/g, "••••••");
              return (
                <div key={l.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-black/45">{category ? t.category[category] : l.kind}</p>
                    <p className="mt-0.5 text-sm font-semibold">{subject}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                    <time className="text-[11px] text-black/45" dateTime={l.createdAt.toISOString()}>
                      {fmt.format(l.createdAt)}
                    </time>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </main>
    </div>
  );
}
