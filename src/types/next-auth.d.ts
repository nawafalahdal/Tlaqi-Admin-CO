import type { DefaultSession } from "next-auth";

type SessionRole = "super_admin" | "executive" | "operations_officer" | "department_admin" | "member";


// next-auth (v5 beta) يعيد تصدير Session/User/JWT من @auth/core بدون إعادة تعريفها
// في وحدته الخاصة، فإضافة الحقول هنا تطال الوحدة الأصلية @auth/core مباشرة
// وإلا لن تندمج (type-only re-export لا يُدمَج مع module augmentation).
declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
      role: SessionRole;
      departmentId: string | null;
      departmentSlug: string | null;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    /** اختار صاحبها "أبقني مسجّلاً" — يُحوَّل إلى مدّة الجلسة في jwt */
    remember?: boolean;
    role: SessionRole;
    departmentId: string | null;
    departmentSlug: string | null;
    mustChangePassword: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    remember?: boolean;
    /** اللحظة التي تنتهي عندها الجلسة بالمللي ثانية */
    sessionExpiry?: number;
    role: SessionRole;
    departmentId: string | null;
    departmentSlug: string | null;
    mustChangePassword: boolean;
  }
}
