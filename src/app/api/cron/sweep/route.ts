import { NextResponse } from "next/server";
import {
  remindExpiringCandidates,
  sweepExpiredCandidateAccounts,
  sweepOverdueRequests,
} from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import { purgeExpiredLoginCodes } from "@/lib/loginCodes";

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

  return NextResponse.json({ ok: true, reminded, expiredAccounts, purgedCodes });
}
