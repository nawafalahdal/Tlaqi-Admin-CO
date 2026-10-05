import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export function HeaderActions({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-2">
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
