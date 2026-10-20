import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/PageStates";
import { accountRoleLabel } from "@/lib/testTracks";

export const dynamic = "force-dynamic";

/** سجلُّ التنبيهات — تنبيهاتُ صاحب الحساب وحده.
 *
 *  كان «سجلُّ الرسائل الصادرة» يَعرض للمؤسس والتنفيذي كلَّ رسالةٍ خرجت لكل
 *  أحد. وقرارُ المؤسس: لكلٍّ تنبيهاتُه هو — أنا أرى أني غيّرت كلمة المرور،
 *  وقائدُ القسم يرى تصعيدَ تذكرته — ولا يرى أحدٌ تنبيهاتِ غيره.
 *
 *  فيُقرأ سجلُّ البريد (`EmailLog`) مقصوراً على بريد صاحب الجلسة في
 *  الاستعلام نفسه — لا تصفيةً بعد القراءة. وتُطمَس الأرقامُ في عناوين رموز
 *  الدخول: رمزٌ قديمٌ لا يُفيد، والسجلُّ يُفتح على شاشاتٍ مشتركة أحياناً. */
export default async function NotificationsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const email = session.user.email;
  if (!email) redirect("/login");

  const logs = await prisma.emailLog.findMany({
    where: { recipient: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: { id: true, kind: true, subject: true, status: true, createdAt: true },
  });

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  // عنوانُ المرسِل وحده (لا الاسم) من الإعداد العلنيّ نفسه الذي يُرسل به البريد
  const fromSetting = process.env.EMAIL_FROM || "hello@tlaqiteam.site";
  const senderAddress = fromSetting.match(/<([^>]+)>/)?.[1] ?? fromSetting;
  const fmt = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const tone = (s: string) =>
    s === "أُرسلت"
      ? { label: "وصلتك على بريدك", cls: "bg-green-50 text-green-800" }
      : s === "فشل الإرسال"
        ? { label: "تعذّر إرسالها", cls: "bg-red-50 text-red-700" }
        : { label: "لم تُرسَل (البريد معطّل)", cls: "bg-amber-50 text-amber-900" };

  return (
    <div className="min-h-screen bg-page">
      <AppHeader theme={theme} roleName={accountRoleLabel(session.user.role)} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader
          title="سجل التنبيهات"
          description="كل تنبيهٍ أرسلته المنصة إليك أنت — من تذكرةٍ صُعِّدت إلى تغيير كلمة مرورك. ولا يرى أحدٌ تنبيهاتِ غيره."
        />
        {/* أين تصل الرسائل، ومن أين تأتي — ليُنقَل المرسِلُ من «غير المرغوب» مرّةً
            فتصل بعدها في البريد الوارد دائماً. والمرسِلُ عنوانٌ معلَن لا سرّ */}
        <Card className="flex flex-col gap-3 p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold text-black/45">تصلك رسائل المنصة على</p>
            <p className="mt-0.5 break-all text-sm font-bold" dir="ltr">
              {email}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900">
            <p className="font-bold">⚠ قد تصل رسائلنا إلى «الرسائل غير المرغوب فيها» (Spam)</p>
            <p className="mt-1">
              ابحث في مجلد Spam عن رسائل المرسِل <span dir="ltr" className="font-bold">{senderAddress}</span>، ثم
              اضغط «ليست رسالة غير مرغوب فيها» (Not spam) أو انقلها إلى البريد الوارد، وأضِف العنوان
              إلى جهات اتصالك — فتصلك رموز الدخول والتنبيهات في البريد الوارد دائماً.
            </p>
          </div>
        </Card>

        {logs.length === 0 ? (
          <EmptyState title="لا تنبيهات لك بعد" />
        ) : (
          <Card className="divide-y divide-black/[0.06] p-0">
            {logs.map((l) => {
              const st = tone(l.status);
              // رموزُ الدخول القديمة لا تُعرَض أرقامُها
              const subject = l.subject.replace(/\b\d{6}\b/g, "••••••");
              return (
                <div key={l.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-black/45">{l.kind}</p>
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
