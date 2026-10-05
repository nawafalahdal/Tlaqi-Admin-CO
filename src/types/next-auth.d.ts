import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "super_admin" | "department_admin";
      departmentId: string | null;
      departmentSlug: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: "super_admin" | "department_admin";
    departmentId: string | null;
    departmentSlug: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: "super_admin" | "department_admin";
    departmentId: string | null;
    departmentSlug: string | null;
  }
}
