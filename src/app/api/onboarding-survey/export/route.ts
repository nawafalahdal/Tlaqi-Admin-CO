import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canManageOnboardingSurvey } from "@/lib/onboardingSurvey";
import { exportOnboardingSurvey } from "@/lib/onboardingExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** **تنزيلُ ملف Excel لاستبيان الانضمام** — للمؤسس والرئيس التنفيذي ومسؤول التشغيل وحدهم.
 *
 *  - الصلاحيةُ من الجلسة هنا في الخادم (الزرُّ في اللوحة ليس هو الحارس): من لا جلسةَ له 401،
 *    ومن لا يملكها 403 — ولا يُكتب سجلُّ تصديرٍ لمحاولةٍ مرفوضة.
 *  - **POST لا GET:** التصديرُ يكتب سجلاً، فلا يُطلَق برابطٍ من موقعٍ آخر (كعكةُ الجلسة
 *    `SameSite=Lax` لا تُرسَل مع POST عابر)، ويُشترط أن يأتي الطلبُ من أصل المنصة نفسه.
 *  - بياناتٌ شخصية: `no-store` و`nosniff`. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return new NextResponse("سجّل الدخول أولاً", { status: 401 });
  if (!canManageOnboardingSurvey(session.user.role)) return new NextResponse("ليس لك تصديرُ هذه البيانات", { status: 403 });

  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host === host;
    } catch {
      ok = false;
    }
    if (!ok) return new NextResponse("طلبٌ من خارج المنصة", { status: 403 });
  }

  const res = await exportOnboardingSurvey({
    id: session.user.id,
    name: session.user.name ?? "—",
    role: session.user.role,
    email: session.user.email ?? null,
  });
  if (!res.ok) return new NextResponse(res.reason, { status: 403 });

  return new NextResponse(new Uint8Array(res.file), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(res.file.byteLength),
      "Content-Disposition": `attachment; filename="${res.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
