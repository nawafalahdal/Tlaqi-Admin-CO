import { NextResponse } from "next/server";
import {
  remindExpiringCandidates,
  sweepExpiredCandidateAccounts,
  sweepOverdueRequests,
  nudgeMissingTwoFactor,
} from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import { purgeExpiredLoginCodes } from "@/lib/loginCodes";
import { sweepThreeMonthAppreciation } from "@/lib/appreciation";
import { sweepEffectiveTerminations } from "@/lib/termination";
import { purgeArchivedTickets, purgeOldEmailLogs } from "@/lib/retention";
import { currentAndNextPeriod } from "@/lib/execution";
import { sweepCarryover } from "@/lib/carryover";
import { ensureMeeting } from "@/lib/reviewMeeting";

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
 *  الطلب حتى لا يستنزف أحد المسار من الخارج. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // التذكير قبل الكنس: من بقي له ساعات يُذكَّر، ومن انقضت مهلته يسقط
  const reminded = await remindExpiringCandidates();
  const expiredAccounts = await sweepExpiredCandidateAccounts();
  await sweepOverdueRequests();
  await sweepTicketEscalation();
  // رموز الدخول قصيرة العمر وكثيرة، فلا تُترك تتراكم في الجدول
  const purgedCodes = await purgeExpiredLoginCodes();
  // الحماية تُذكَّر لا تُفترض: من لم يفعّل طريقه الثاني يُنبَّه دورياً
  const totpNudged = await nudgeMissingTwoFactor();
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

  return NextResponse.json({
    ok: true,
    carried: carry?.carried ?? 0,
    carrySkipped: carry?.skipped ?? 0,
    carryEscalated: carry?.escalated ?? 0,
    reminded,
    expiredAccounts,
    purgedCodes,
    totpNudged,
    appreciated,
    terminated,
    archivedTickets,
    purgedEmailLogs,
  });
}
