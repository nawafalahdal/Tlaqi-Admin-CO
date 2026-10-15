import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./LogoutButton";
import { LocaleToggle } from "./LocaleToggle";
import { ThemeToggle } from "./ThemeToggle";
import { ImproveButton } from "./ImproveButton";
import { getLocale, getDictionary } from "@/i18n/server";

export async function HeaderActions({ color }: { color: string }) {
  const [session, t] = await Promise.all([
    auth(),
    getLocale().then(getDictionary),
  ]);
  const isAdmin = session && session.user.role !== "member";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* السمة أولاً: أكثرُ ما يُبدَّل، ويُراد في متناول اليد */}
      <ThemeToggle color={color} />
      <LocaleToggle color={color} />
      {/* و«تحسين» ثالثُهم: الملاحظةُ تُقال حيث رُئيت أو تُفقَد */}
      <ImproveButton color={color} />
      {isAdmin && (
        <Link
          href="/admin/security"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
          style={{ color, border: `1px solid ${color}55` }}
        >
          {t.common.twoFactor}
        </Link>
      )}
      {/* قادة الأقسام ومسؤول التشغيل لا يمرّون بلوحة /admin إطلاقاً،
          فرابط البيانات يلزم أن يكون في الترويسة لا فيها وحدها */}
      {session && session.user.role !== "member" && (
        <Link
          href="/admin/profile"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
          style={{ color, border: `1px solid ${color}55` }}
        >
          {t.adminProfile.title}
        </Link>
      )}
      <Link
        href="/change-password"
        className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
        style={{ color, border: `1px solid ${color}55` }}
      >
        {t.common.changePassword}
      </Link>
      <LogoutButton color={color} />
    </div>
  );
}
