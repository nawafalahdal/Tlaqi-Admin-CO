import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./LogoutButton";
import { LocaleToggle } from "./LocaleToggle";
import { ThemeToggle } from "./ThemeToggle";
import { ControlGroup, ControlDivider } from "./ControlGroup";
import { getLocale, getDictionary } from "@/i18n/server";

/** الترويسةُ صارت محايدةً بلون الصفحة (انظر `AppHeader`)، فأدواتُها بحبر الصفحة
 *  في السمتين. ويبقى `color` مقبولاً لأن ستاً وعشرين صفحةً تمرّره — ولا يُستعمل. */
export async function HeaderActions(props: { color?: string }) {
  void props;
  const color = "var(--ink)";
  const [session, t] = await Promise.all([
    auth(),
    getLocale().then(getDictionary),
  ]);
  const isAdmin = session && session.user.role !== "member";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* أدواتُ العرض الثلاث في شريطٍ واحد — انظر `ControlGroup` */}
      <ControlGroup color={color}>
        <ThemeToggle />
        <ControlDivider />
        <LocaleToggle />
      </ControlGroup>
      {isAdmin && (
        <Link
          href="/admin/security"
          className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
          style={{ color, border: `1px solid color-mix(in oklab, ${color} 22%, transparent)` }}
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
          style={{ color, border: `1px solid color-mix(in oklab, ${color} 22%, transparent)` }}
        >
          {t.adminProfile.title}
        </Link>
      )}
      <Link
        href="/change-password"
        className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
        style={{ color, border: `1px solid color-mix(in oklab, ${color} 22%, transparent)` }}
      >
        {t.common.changePassword}
      </Link>
      <LogoutButton color={color} />
    </div>
  );
}
