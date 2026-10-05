import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isLockedOut, recordFailedAttempt, clearFailedAttempts } from "@/lib/loginAttempts";
import { verifyTotpCode } from "@/lib/totp";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "البريد الإلكتروني", type: "email" },
        password: { label: "كلمة المرور", type: "password" },
        totp: { label: "رمز التحقق", type: "text" },
      },
      authorize: async (credentials) => {
        const email = (credentials?.email as string | undefined)?.toLowerCase().trim();
        const password = credentials?.password as string | undefined;
        const totp = credentials?.totp as string | undefined;
        if (!email || !password) return null;

        // مقاومة التخمين وحشو بيانات الاعتماد: قفل مؤقت بعد محاولات فاشلة متتالية
        if (await isLockedOut(email)) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { department: true },
        });
        if (user && (await bcrypt.compare(password, user.passwordHash))) {
          if (user.totpEnabled) {
            if (!user.totpSecret || !totp || !verifyTotpCode(user.totpSecret, totp, user.email)) {
              await recordFailedAttempt(email);
              return null;
            }
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
        if (
          member &&
          member.passwordHash &&
          member.approvalStatus === "approved" &&
          (await bcrypt.compare(password, member.passwordHash))
        ) {
          await clearFailedAttempts(email);
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
