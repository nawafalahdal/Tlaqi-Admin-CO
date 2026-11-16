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
      /** مرشّحٌ لم يُعتمد بعد (عضوٌ قبل الاعتماد النهائي) — يُحصَر في صفحات الاختبار والانتظار (`lib/candidateGate`) */
      candidate?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    /** اختار صاحبها "أبقني مسجّلاً" — يُحوَّل إلى مدّة الجلسة في jwt */
    remember?: boolean;
    role: SessionRole;
    departmentId: string | null;
    departmentSlug: string | null;
    mustChangePassword: boolean;
    /** دخل بسجلّ ترشّحٍ لمنصبٍ قيادي لم يُعتمد بعد — تُراجَع جلستُه في كل طلب */
    leadershipCandidate?: boolean;
    /** انظر `Session.user.candidate` */
    candidate?: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    remember?: boolean;
    /** اللحظة التي تنتهي عندها الجلسة بالمللي ثانية */
    sessionExpiry?: number;
    /** بصمةُ كعكة ربط الجلسة بالمتصفّح (`lib/sessionBinding`) — لا القيمةُ نفسها */
    sessionBinding?: string;
    role: SessionRole;
    departmentId: string | null;
    departmentSlug: string | null;
    mustChangePassword: boolean;
    /** انظر `User.leadershipCandidate` */
    leadershipCandidate?: boolean;
    /** مرشّحٌ لم يُعتمد بعد — تُراجَع جلستُه في كل طلب حتى يُعتمد (انظر `jwt` في `auth.ts`) */
    candidate?: boolean;
    /** آخر مراجعةٍ للحساب من القاعدة (`lib/sessionAccount`) بالمللي ثانية */
    accountCheckedAt?: number;
    /** نموذجُ الحساب الذي صدر به التوكن (`ACCOUNT_MODEL` في `auth.ts`) */
    accountModel?: number;
  }
}
