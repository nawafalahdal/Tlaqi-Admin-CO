import { NextResponse } from "next/server";
import { sweepExpiredCandidateAccounts, sweepOverdueRequests } from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** كنس مجدول كل ساعة (Vercel Cron) — يُسقط الحسابات التي انقضت مهلتها حتى
 *  لو لم يفتح أحد اللوحة، فلا يتوقف تطبيق الحوكمة على وجود مستخدم متصفّح.
 *
 *  لا يُغني هذا عن فحص المهلة لحظة الدخول: ذاك هو ما يمنع الدخول فعلاً،
 *  وهذا يُبقي القوائم والسجل مطابقين للواقع.
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

  const expiredAccounts = await sweepExpiredCandidateAccounts();
  await sweepOverdueRequests();
  await sweepTicketEscalation();

  return NextResponse.json({ ok: true, expiredAccounts });
}
