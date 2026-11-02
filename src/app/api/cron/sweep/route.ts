import { NextResponse } from "next/server";
import { sweepExpiredCandidateAccounts, sweepOverdueRequests } from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import { purgeExpiredLoginCodes } from "@/lib/loginCodes";
import { sweepThreeMonthAppreciation } from "@/lib/appreciation";
import { sweepEffectiveTerminations } from "@/lib/termination";
import { purgeArchivedTickets, purgeOldEmailLogs } from "@/lib/retention";
import { currentAndNextPeriod } from "@/lib/execution";
import { sweepCarryover } from "@/lib/carryover";
import { ensureMeeting } from "@/lib/reviewMeeting";
import { cronAuthorization } from "@/lib/cronAuth";
import { sweepMarketing } from "@/lib/marketing/sweep";

export const dynamic = "force-dynamic";

/** كنس مجدول يومي (Vercel Cron) — شبكة أمان تُنظّف ما فات حتى لو لم يفتح
 *  أحد اللوحة ذلك اليوم.
 *
 *  الجدولة يومية لا بالساعة لأن خطة Vercel المجانية (Hobby) لا تسمح بأكثر
 *  من تشغيل واحد يومياً. وهذا لا يُضعف الحوكمة: منع الدخول يتم بفحص لحظي
 *  عند كل محاولة تسجيل دخول، ويُكنس أيضاً عند فتح أي لوحة إدارية. مهمة
 *  هذا المسار مطابقة القوائم والسجل للواقع، لا الحماية.
 *
 *  Vercel يرسل CRON_SECRET في ترويسة Authorization؛ بدون المفتاح يُرفض
 *  الطلب حتى لا يستنزف أحد المسار من الخارج. **وإن غاب المفتاح من البيئة
 *  رُفض كلُّ طلب** — فالإعدادُ الناقص يُوقف الكنس لا يفتحه — ويُسجَّل
 *  ذلك بلا قيمةٍ ولا ترويسة. والسائلُ لا يُخبَر أيّهما وقع. */
export async function GET(request: Request) {
  const auth = cronAuthorization(request.headers.get("authorization"));
  if (auth !== "ok") {
    if (auth === "unconfigured") console.error("[cron/sweep] refused: CRON_SECRET is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // **ولا تذكيرَ هنا.** كان الكنسُ يُذكّر المرشّحَ قبل سقوط مهلته ويُذكّر كلَّ إداريٍّ لم يفعّل التحقق
  // الثنائي كل أسبوعين — وأوقفت الإدارةُ الرسالتين (`EMAIL_POLICY`، a588b11). فبقي الكنسُ يناديهما كل يوم
  // ويُكتب عن كلّ نداءٍ سطرُ «لم تُرسل» في الإكسل: تذكيرٌ موقوفٌ يعود بلا رسالة. فحُذفت المهمّتان من
  // أصلهما — والتحقق الثنائي نفسه باقٍ كما هو (`/admin/security`) — والفحصُ
  // `check-discontinued-features` يمنع عودتهما. انظر docs/audit/TLAQI_DISCONTINUED_FEATURES.md
  const expiredAccounts = await sweepExpiredCandidateAccounts();
  await sweepOverdueRequests();
  await sweepTicketEscalation();
  // رموز الدخول قصيرة العمر وكثيرة، فلا تُترك تتراكم في الجدول
  const purgedCodes = await purgeExpiredLoginCodes();
  // التكريم لا ينتظر أن يفتح أحدٌ اللوحة يوم الذكرى
  const appreciated = await sweepThreeMonthAppreciation();
  // من وُوفق على إنهائه وحلّ تاريخُه: الخروج يقع هنا لا عند الموافقة
  const terminated = await sweepEffectiveTerminations();
  // الأرشفة: ما زال عن الشاشة ليلة السبت يُمحى من القاعدة هنا — وقد
  // كُتب في الإكسل قبل ذلك، فالمحو تنظيفٌ لا فقد. والاختفاء وقع في
  // موعده بشرط القراءة، وهذا يُفرّغ الجدول بعده على مهل.
  const archivedTickets = await purgeArchivedTickets();
  const purgedEmailLogs = await purgeOldEmailLogs();

  // ── نظامُ التنفيذ: تُنشأ الفترتان وتُرحَّل بقايا الأسبوع المنصرم.
  //
  // **والكنسُ لا يَفتح أسبوعاً أبداً.** الفتحُ قرارٌ إداريٌّ صريح، ولو
  // فُتح هنا لصار حدثاً تقويمياً: يبدأ الأسبوع والمراجعةُ لم تقع. فهذا
  // يُنشئ الصفَّ ويُرحّل ويُغلق المنصرم — ويقف.
  const { current, next } = await currentAndNextPeriod();
  const carry = await sweepCarryover({});
  // واجتماعُ المراجعة يُنشَأ مع الفترة ولا يتكرّر — التفرّدُ يَمنعه
  await ensureMeeting(current.id);
  await ensureMeeting(next.id);

  // ── وكيلُ التسويق: فتحُ التخطيط في موعده، والردودُ والأرشفةُ المعلّقة — معزولٌ بكامله
  const marketing = await sweepMarketing();

  return NextResponse.json({
    marketing,
    ok: true,
    carried: carry?.carried ?? 0,
    carrySkipped: carry?.skipped ?? 0,
    carryEscalated: carry?.escalated ?? 0,
    expiredAccounts,
    purgedCodes,
    appreciated,
    terminated,
    archivedTickets,
    purgedEmailLogs,
  });
}
