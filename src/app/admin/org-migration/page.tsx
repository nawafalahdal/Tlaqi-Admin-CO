import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { legacyInventory, APPLY_ORDER, type LegacyCase } from "@/lib/org/legacyConversion";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
import { applyLegacyCaseAction, applyAllLegacyAction } from "./actions";

export const dynamic = "force-dynamic";

/** **ترحيلُ فصل قيادة اللجان — للمؤسس وحده.**
 *
 *  الجردُ يُقرأ ولا يكتب: كلُّ ما بقي من نظام اللجان الأول برمزه، وما سيُفعل به، وأثرُه على
 *  الحسابات والصلاحيات. والتطبيقُ صريح: حالةً حالة أو الآليةُ كلُّها بترتيب الخطة، ولكلٍّ سجلُّ
 *  تدقيقٍ بما قبله وما بعده (`docs/TLAQI_COMMITTEE_LEAD_SEPARATION_PLAN_AR.md`). */
export default async function OrgMigrationPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // دورُ المؤسس من القاعدة لا من الجلسة — ولغيره صفحةٌ غير موجودة
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } });
  if (session.user.role !== "super_admin" || !me?.isActive || me.role !== "super_admin") notFound();

  const t = getDictionary(await getLocale());
  const L = t.org.migration;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const { cases } = await legacyInventory();
  const order = (c: LegacyCase) => {
    const i = APPLY_ORDER.indexOf(c.code);
    return i < 0 ? 100 : i;
  };
  const sorted = [...cases].sort((a, b) => order(a) - order(b) || a.key.localeCompare(b.key));
  const autoCount = cases.filter((c) => c.auto).length;

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={L.title} description={L.desc} />
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm font-semibold">{fmt(L.total, cases.length)}</p>
          {autoCount > 0 && (
            <ActionForm
              action={applyAllLegacyAction}
              submits={[{ label: L.applyAll }]}
              pendingLabel={L.applying}
              theme={theme}
              confirm={{ title: L.applyAllTitle, body: L.applyAllBody, confirmLabel: L.applyAll }}
            />
          )}
        </Card>
        {sorted.length === 0 ? (
          <Card className="p-5 text-sm text-black/60">{L.none}</Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {sorted.map((c) => (
              <li key={c.key}>
                <Card className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">
                      <span className="me-2 rounded-md bg-black/[0.06] px-1.5 py-0.5 font-mono text-xs" dir="ltr">
                        {c.code}
                      </span>
                      {c.subject}
                      {c.committee && c.committee.name !== c.subject && <span className="text-black/50"> · {c.committee.name}</span>}
                      {c.root && <span className="text-black/50"> ← {c.root.name}</span>}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        c.auto ? "bg-emerald-50 text-emerald-800" : c.code === "L2" || c.code === "L8" || c.code === "L10" ? "bg-black/[0.05] text-black/60" : "bg-amber-50 text-amber-900"
                      }`}
                    >
                      {c.auto ? L.auto : c.code === "L2" || c.code === "L8" || c.code === "L10" ? L.record : L.decision}
                    </span>
                  </div>
                  <dl className="grid gap-1 text-xs sm:grid-cols-[8rem_1fr]">
                    <dt className="text-black/50">{L.now}</dt>
                    <dd>{c.now}</dd>
                    <dt className="text-black/50">{L.action}</dt>
                    <dd>{c.action}</dd>
                    <dt className="text-black/50">{L.effect}</dt>
                    <dd>{c.effect}</dd>
                  </dl>
                  {c.auto && (
                    <ActionForm action={applyLegacyCaseAction} submits={[{ label: L.apply, variant: "outline" }]} pendingLabel={L.applying} theme={theme} compact>
                      <input type="hidden" name="key" value={c.key} />
                    </ActionForm>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
