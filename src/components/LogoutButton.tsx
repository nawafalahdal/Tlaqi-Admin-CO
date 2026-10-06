import { signOut } from "@/auth";
import { getLocale, getDictionary } from "@/i18n";

export async function LogoutButton({ color }: { color: string }) {
  const t = getDictionary(await getLocale());

  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-90 hover:opacity-100"
        style={{ color, border: `1px solid ${color}55` }}
      >
        {t.common.logout}
      </button>
    </form>
  );
}
