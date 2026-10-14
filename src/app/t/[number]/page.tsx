import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ticketVisibilityWhere, ticketScopeWhere } from "@/lib/tickets";
import { BRAND } from "@/lib/brand";
import { LogoLockup } from "@/components/Logo";

export const dynamic = "force-dynamic";

/** باب التذكرة الواحد — يقود كلَّ دورٍ إلى لوحته.
 *
 *  **هذا إصلاح العطب الذي أبلغت عنه:** كانت رسائل التذاكر كلّها تحمل
 *  رابطاً واحداً `/admin/tickets`. وتلك الصفحة تردّ العضو: أدوارُها
 *  المسموحة أربعة ليس فيها `member`، فيُحوَّل إلى `/admin`، و`/admin`
 *  يُحوّله إلى `/member`. فيضغط العضو رابط تذكرته فيجد نفسه في صفحةٍ
 *  أخرى لا تذكرةَ فيها ظاهرة — والتذكرة موجودة.
 *
 *  فصار الرابط يشير إلى هنا: يُستوثَق أولاً، ثم تُقرأ التذكرة بنفس
 *  مُصفّي الرؤية الذي تستعمله اللوحات (`ticketVisibilityWhere`)، ثم
 *  يُحوَّل صاحبُها إلى اللوحة التي تُظهرها له فعلاً — ومعها مِرساةٌ
 *  تُبرز التذكرة بعينها.
 *
 *  ومن لا تخصّه يُقال له ذلك صريحاً: قائمةٌ فارغة تُقرأ عطباً، وجملةٌ
 *  واضحة تُقرأ حدّاً. والرقم في الرابط رقمُ التذكرة لا معرّفها — هو ما
 *  يراه الناس في رسائلهم.
 */
export default async function TicketEntryPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const ticketNumber = Number(number);
  if (!Number.isInteger(ticketNumber) || ticketNumber <= 0) notFound();

  const session = await auth();
  if (!session) {
    // يعود إلى هنا بعد الدخول — و`safeRedirectPath` يحرس المقصد
    redirect(`/login?callbackUrl=${encodeURIComponent(`/t/${ticketNumber}`)}`);
  }

  // الرؤية تُحسم بنفس القاعدة التي تحسمها اللوحات، لا بقاعدةٍ ثانية
  // تُخالفها: تذكرةٌ يُدخلها الباب ولا تُظهرها اللوحة عطبٌ أسوأ.
  const visible = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber }, ticketVisibilityWhere(session)] },
    select: { id: true },
  });

  if (visible) {
    const board = session.user.role === "member" ? "/member" : "/admin/tickets";
    redirect(`${board}#ticket-${ticketNumber}`);
  }

  // أمّا تذكرتُه هو التي أُرشفت فيُقال لها اسمُها: «لا تخصّك» عن
  // تذكرةٍ أغلقها بيده قبل أسبوعين تُقرأ عطباً في المنصة. والشرط نطاقُه
  // هو، فلا يُكشَف بهذا شيءٌ لمن يُجرّب الأرقام.
  const mineButArchived = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber }, ticketScopeWhere(session)] },
    select: { id: true },
  });

  if (mineButArchived) {
    return (
      <main
        className="flex min-h-screen items-center justify-center px-4"
        style={{ background: BRAND.temptress }}
      >
        <div className="w-full max-w-sm text-center">
          <div className="mb-8 flex justify-center">
            <LogoLockup height={34} tone="light" />
          </div>
          <div className="rounded-3xl bg-white p-8 shadow-xl">
            <h1 className="mb-2 text-lg font-bold text-black/90">أُرشفت هذه التذكرة</h1>
            <p className="text-sm leading-relaxed text-black/55">
              أُغلقت ومضى عليها أسبوع، فزالت من شاشة العمل ليلة السبت بعد الاجتماع — وسجلُّها
              كاملاً محفوظٌ في ملفّ الإكسل المرجعي: موضوعها وردُّها ومن أغلقها ومتى.
            </p>
            <a
              href={session.user.role === "member" ? "/member" : "/admin/tickets"}
              className="mt-6 inline-block rounded-xl px-5 py-3 text-sm font-semibold text-on-brand"
              style={{ background: BRAND.temptress }}
            >
              افتح لوحتي
            </a>
          </div>
        </div>
      </main>
    );
  }

  // موجودةٌ ولا تخصّه، أو غير موجودة — ولا يُفرَّق بينهما في الجواب:
  // التفريق يُخبر من يُجرّب الأرقام أيُّها تذكرةٌ قائمة.
  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: BRAND.temptress }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="mb-8 flex justify-center">
          <LogoLockup height={34} tone="light" />
        </div>
        <div className="rounded-3xl bg-white p-8 shadow-xl">
          <h1 className="mb-2 text-lg font-bold text-black/90">هذه التذكرة لا تخصّك</h1>
          <p className="text-sm leading-relaxed text-black/55">
            إمّا أنها ليست من تذاكرك، أو أن الرقم غير صحيح. وتذاكرك كلّها في لوحتك.
          </p>
          <a
            href={session.user.role === "member" ? "/member" : "/admin/tickets"}
            className="mt-6 inline-block rounded-xl px-5 py-3 text-sm font-semibold text-on-brand"
            style={{ background: BRAND.temptress }}
          >
            افتح لوحتي
          </a>
        </div>
      </div>
    </main>
  );
}
