import { redirect } from "next/navigation";

/** **انتقلت إلى «الأعضاء»** (طلبُ المؤسس، 24 نوفمبر 2026 — إدارةُ الأشخاص في مكانٍ واحد): الرابطُ القديم — من بريدٍ أو
 *  إشارةٍ محفوظة — يُحوَّل إلى تبويبه هناك بمعاملاته كما هي. والصلاحيةُ يفحصها التبويبُ نفسُه. */
export default async function Moved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ view: "terminations" });
  for (const [k, v] of Object.entries(sp)) if (k !== "view" && typeof v === "string") q.set(k, v);
  redirect(`/admin/people?${q.toString()}`);
}
