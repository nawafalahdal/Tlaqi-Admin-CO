import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;
  const isProtected = pathname.startsWith("/admin") || pathname.startsWith("/member");

  if (isProtected && !session) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (session?.user.mustChangePassword && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl.origin));
  }

  if (isProtected && session) {
    // حارس القطاع: لوحات /admin للأدوار الإدارية فقط، وبوابة /member للأعضاء فقط
    if (pathname.startsWith("/admin") && session.user.role === "member") {
      return NextResponse.redirect(new URL("/member", req.nextUrl.origin));
    }
    if (pathname.startsWith("/member") && session.user.role !== "member") {
      return NextResponse.redirect(new URL("/admin", req.nextUrl.origin));
    }

  }
});

export const config = {
  matcher: ["/admin/:path*", "/member/:path*", "/change-password"],
};
