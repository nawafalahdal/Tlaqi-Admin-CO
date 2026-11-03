import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor } from "@/lib/brand";
import { departmentLeaderChangePreview } from "@/lib/org/departmentLeadership";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { Field, inputCls, textareaCls, fmtWhen } from "@/app/committees/_components/bits";
import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
import { changeLeaderAction } from "../../../governance/actions";

export const dynamic = "force-dynamic";

/** تغييرُ قائد القسم — للمؤسس والرئيس التنفيذي وحدهما (يحرسها `proxy` ثم القاعدةُ ثانيةً) */
export default async function DepartmentLeaderPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const { slug } = await params;
  const dept = await prisma.department.findUnique({ where: { slug }, select: { id: true, colorHex: true } });
  if (!dept) notFound();
  const p = await departmentLeaderChangePreview(session.user.id, dept.id);
  if (!p) notFound();
  const t = getDictionary(await getLocale());
  const G = t.org.governance;
  const theme = themeFromColor(dept.colorHex);
  const names = (v: unknown) =>
    Array.isArray((v as { leaders?: unknown[] })?.leaders)
      ? ((v as { leaders: { name: string }[] }).leaders.map((l) => l.name).join("، ") || G.noLeader)
      : G.noLeader;

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <Link href={`/admin/departments/${slug}`} className="text-xs font-bold text-black/50 hover:underline">
          ← {p.dept.name}
        </Link>
        <PageHeader title={`${G.leaderTitle} — ${p.dept.name}`} description={G.leaderDesc} />
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-sm font-bold">{G.current}</h2>
          {p.current.length === 0 ? (
            <p className="text-sm text-black/60">{G.noLeader}</p>
          ) : (
            p.current.map((l) => (
              <p key={l.id} className="text-sm">
                <strong>{l.fullName}</strong> <span className="text-xs text-black/50">{fmt(G.since, fmtWhen(l.createdAt, false))}</span>
              </p>
            ))
          )}
          <p className="text-xs text-black/60">{fmt(G.openWork, p.openWork.planTasks, p.openWork.objectives, p.openWork.tickets, p.openWork.approvals)}</p>
        </Card>
        <Card className="p-5">
          <ActionForm
            action={changeLeaderAction}
            submits={[{ label: G.apply }]}
            pendingLabel={G.applying}
            theme={theme}
            confirm={{ title: G.confirmTitle, body: G.confirmBody, confirmLabel: G.apply }}
          >
            <input type="hidden" name="departmentId" value={p.dept.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="confirm" value="1" />
            <Field label={G.replacement}>
              <select name="memberId" required defaultValue="" className={inputCls}>
                <option value="" disabled>
                  {G.choose}
                </option>
                {p.candidates.map((c) => (
                  <option key={c.id} value={c.id} disabled={!!c.leadsCommittee}>
                    {c.fullName}
                    {c.jobTitle ? ` — ${c.jobTitle}` : ""}
                    {c.leadsCommittee ? ` (${fmt(G.leadsCommittee, c.leadsCommittee)})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={G.reason}>
              <textarea name="reason" required maxLength={300} rows={3} className={textareaCls} />
            </Field>
          </ActionForm>
        </Card>
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-sm font-bold">{G.history}</h2>
          {p.history.length === 0 ? (
            <p className="text-xs text-black/50">{G.noHistory}</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs">
              {p.history.map((h) => (
                <li key={h.id}>
                  {fmt(G.historyRow, fmtWhen(h.createdAt, true), names(h.before), (h.after as { leader?: { name?: string } })?.leader?.name ?? "—", h.actorName)}
                  {h.note ? <span className="text-black/50"> — {h.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
