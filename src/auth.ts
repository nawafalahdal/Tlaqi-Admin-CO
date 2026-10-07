import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isLockedOut, recordFailedAttempt, clearFailedAttempts } from "@/lib/loginAttempts";
import { verifyTotpCode } from "@/lib/totp";
import { consumeLoginCode } from "@/lib/loginCodes";
import { candidateWindowExpired, markFirstLogin } from "@/lib/workflow";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "البريد الإلكتروني", type: "email" },
        password: { label: "كلمة المرور", type: "password" },
        totp: { label: "رمز التحقق", type: "text" },
        loginCode: { label: "رمز الدخول المُرسَل بالبريد", type: "text" },
      },
      authorize: async (credentials) => {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim();
        const password = credentials?.password as string | undefined;
        const totp = credentials?.totp as string | undefined;
        const loginCode = credentials?.loginCode as string | undefined;
        if (!email || !password) return null;

        /** التحقّق من رمز البريد.
         *
         *  يُستدعى بعد صحّة كلمة المرور فقط: استهلاك الرمز قبل التحقّق من
         *  الكلمة يتيح لمن يعرف البريد وحده أن يُحرق رموز صاحبه ويمنعه من
         *  الدخول. ومن فعّل التحقّق بخطوتين يُعفى — عاملان يكفيان، وطلب
         *  ثالث يرهق بلا زيادة أمان حقيقية. */
        const codeAccepted = async (totpEnabled: boolean) => {
          if (totpEnabled) return true;
          if (!loginCode) return false;
          const result = await consumeLoginCode(email, loginCode);
          return result.ok;
        };

        // مقاومة التخمين وحشو بيانات الاعتماد: قفل مؤقت بعد محاولات فاشلة متتالية
        if (await isLockedOut(email)) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { department: true },
        });
        // الحساب المُنحّى يبقى سجلاً فقط — لا يَقبل دخولاً بعد تنحيته
        if (user && user.isActive && (await bcrypt.compare(password, user.passwordHash))) {
          if (user.totpEnabled) {
            if (!user.totpSecret || !totp || !verifyTotpCode(user.totpSecret, totp, user.email)) {
              await recordFailedAttempt(email);
              return null;
            }
          } else if (!(await codeAccepted(false))) {
            await recordFailedAttempt(email);
            return null;
          }
          await clearFailedAttempts(email);
          return {
            id: user.id,
            name: user.fullName,
            email: user.email,
            role: user.role,
            departmentId: user.departmentId,
            departmentSlug: user.department?.slug ?? null,
            mustChangePassword: user.mustChangePassword,
          };
        }

        const member = await prisma.member.findUnique({
          where: { email },
          include: { department: true },
        });
        // المرشّح يدخل منذ لحظة إنشاء حسابه — قبل الاختبار وقبل الاعتماد —
        // لأن هذه هي الخطوة التي يغيّر فيها كلمة المرور المؤقتة ثم يبدأ
        // اختباره. حارس المسارات (proxy) هو من يحصره في صفحة الاختبار حتى
        // يُعتمد. المرفوض أو من أُنهيت عضويته لا يدخل إطلاقاً.
        // المهلة تُحسب هنا لحظياً من تاريخ إصدار الرمز، لا من حقل يضعه كنس
        // مجدول: لو تعطّل الكنس أو تأخر، يظل الرمز المنتهي مرفوضاً. هذه هي
        // نقطة الفرض الحقيقية؛ الكنس مهمته تنظيف القوائم لا الحماية.
        const windowExpired = member ? candidateWindowExpired(member) : false;

        const candidateAllowed =
          member &&
          member.isActive &&
          member.approvalStatus !== "rejected" &&
          !member.terminatedAt &&
          !windowExpired;

        if (
          member &&
          candidateAllowed &&
          member.passwordHash &&
          (await bcrypt.compare(password, member.passwordHash))
        ) {
          // الأعضاء لا يملكون التحقّق بخطوتين، فرمز البريد هو عاملهم الثاني
          if (!(await codeAccepted(false))) {
            await recordFailedAttempt(email);
            return null;
          }
          await clearFailedAttempts(email);
          await markFirstLogin(member.id);
          return {
            id: member.id,
            name: member.fullName,
            email: member.email,
            role: "member",
            departmentId: member.departmentId,
            departmentSlug: member.department?.slug ?? null,
            mustChangePassword: member.mustChangePassword,
          };
        }

        await recordFailedAttempt(email);
        return null;
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
        token.departmentId = user.departmentId;
        token.departmentSlug = user.departmentSlug;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role;
        session.user.departmentId = token.departmentId;
        session.user.departmentSlug = token.departmentSlug;
        session.user.mustChangePassword = token.mustChangePassword;
      }
      return session;
    },
  },
});
