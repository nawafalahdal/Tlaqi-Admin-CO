import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./LogoutButton";

export async function HeaderActions({ color }: { color: string }) {
  const session = await auth();
  const isAdmin = session && session.user.role !== "member";

  return (
    <div className="flex items-center gap-2">
      {isAdmin && (
        <Link
          href="/admin/security"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
          style={{ color, border: `1px solid ${color}55` }}
        >
          التحقق بخطوتين
        </Link>
      )}
      <Link
        href="/change-password"
        className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
        style={{ color, border: `1px solid ${color}55` }}
      >
        تغيير كلمة المرور
      </Link>
      <LogoutButton color={color} />
    </div>
  );
}
