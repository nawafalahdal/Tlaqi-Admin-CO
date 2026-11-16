import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { isCandidatePathAllowed, isCandidateSession } from "@/lib/candidateGate";

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;
  const isProtected = pathname.startsWith("/admin") || pathname.startsWith("/member");
  // وكيلُ التسويق واللجانُ للإداري والعضو معاً — فلا تحويلَ بالدور، وحرسُهما في صفحاتهما
  const needsSession =
    isProtected ||
    pathname.startsWith("/marketing") ||
    pathname.startsWith("/committees") ||
    pathname === "/onboarding-survey" ||
    // الإدارةُ العليا بجلسة — إلا صفحةَ قبول الدعوة: المدعوُّ قد لا يكون له حسابٌ بعد
    (pathname.startsWith("/senior") && !pathname.startsWith("/senior/invite/")) ||
    pathname.startsWith("/agreements") ||
    // اختبارُ العضو القائم — لصاحبه بجلسته (`lib/assessments`)
    pathname.startsWith("/assessment");

  if (needsSession && !session) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (session?.user.mustChangePassword && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl.origin));
  }

  // **المرشّحُ قبل الاعتماد النهائي لا يدخل الواجهة الداخلية** (`lib/candidateGate`): صفحاتُ رحلته وحدها، وصفحةُ
  // قبول دعوة الإدارة العليا العامة. والحالةُ من القاعدة (تُراجَع الجلسةُ في كل طلبٍ ما دام مرشّحاً)
  if (session && isCandidateSession(session) && !isCandidatePathAllowed(pathname) && !pathname.startsWith("/senior/invite/")) {
    return NextResponse.redirect(new URL("/member", req.nextUrl.origin));
  }

  if (isProtected && session) {
    // حارس القطاع: لوحات /admin للأدوار الإدارية فقط، وبوابة /member للأعضاء فقط
    if (pathname.startsWith("/admin") && session.user.role === "member") {
      return NextResponse.redirect(new URL("/member", req.nextUrl.origin));
    }
    if (pathname.startsWith("/member") && session.user.role !== "member") {
      return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
    }
    // ترحيلُ الهيكل للمؤسس وحده — يُردّ هنا بتحويلٍ حقيقي، لا بصفحة «غير موجودة» مُبثّةٍ بحالة 200
    // (حدُّ التحميل في `/admin` يبثّ الاستجابة). والصفحةُ تفحص الدورَ من القاعدة ثانيةً
    if (pathname.startsWith("/admin/org-migration") && session.user.role !== "super_admin") {
      return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
    }
    // قراراتُ الحوكمة (تغييرُ قائد القسم، وحالةُ العضوية) للمؤسس والرئيس التنفيذي وحدهما — تحويلٌ حقيقي
    // هنا، والقاعدةُ تفحص الدورَ ثانيةً في `lib/org`
    const top = session.user.role === "super_admin" || session.user.role === "executive";
    if (!top && (/^\/admin\/departments\/[^/]+\/leader/.test(pathname) || /^\/admin\/people\/[^/]+\/[^/]+\/membership/.test(pathname))) {
      return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
    }

  }
});

export const config = {
  // والصفحاتُ الداخليةُ التي لا تشترط جلسةً هنا (التقويم والهيكل والوثائق والتنبيهات والتحسين) تمرّ بالوكيل أيضاً —
  // لحصر المرشّح وحده؛ ولا يتغيّر بها شيءٌ لغيره
  matcher: [
    "/admin/:path*", "/member/:path*", "/marketing/:path*", "/marketing", "/committees/:path*", "/committees",
    "/senior/:path*", "/senior", "/agreements/:path*", "/agreements", "/change-password", "/onboarding-survey",
    "/calendar/:path*", "/calendar", "/structure/:path*", "/structure", "/plans/:path*", "/plans",
    "/notifications/:path*", "/notifications", "/improve/:path*", "/improve",
    "/assessment/:path*",
  ],
};
