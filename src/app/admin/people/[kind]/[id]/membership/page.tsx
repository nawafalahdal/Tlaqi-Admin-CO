import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { membershipExitPreview } from "@/lib/org/membership";
import { ActionForm } from "@/app/committees/_components/ActionForm";
import { Field, inputCls, textareaCls } from "@/app/committees/_components/bits";
import { getLocale, getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/fmt";
import { terminateMembershipAction, suspendMemberAction, reinstateMemberAction } from "../../../../governance/actions";

export const dynamic = "force-dynamic";

/** حالةُ العضوية والوصول: إنهاءٌ (بعرض أثره وبديلٍ للمسؤوليات)، وإيقافٌ مؤقت، ورفعُه — للمؤسس والرئيس وحدهما */
export default async function MembershipPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const { kind, id } = await params;
  if (kind !== "member") notFound();
  const p = await membershipExitPreview(session.user.id, id);
  if (!p) notFound();
  const t = getDictionary(await getLocale());
  const G = t.org.governance;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);
  const m = p.member;
  const leads = p.committees.filter((c) => c.leads).length;

  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <Link href={`/admin/people/member/${m.id}`} className="text-xs font-bold text-black/50 hover:underline">
          ← {m.fullName}
        </Link>
        <PageHeader title={`${G.membershipTitle} — ${m.fullName}`} description={m.department?.name ?? "—"} />
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <span className="rounded-full bg-black/[0.06] px-3 py-1 text-xs font-bold">{G.state[m.state]}</span>
          {m.state === "suspended" && m.suspendedReason ? <span className="text-xs text-black/55">{m.suspendedReason}</span> : null}
        </Card>

        {m.state === "departed" ? (
          <Card className="p-5 text-sm text-black/70">{G.departedNote}</Card>
        ) : p.leaderAccount ? (
          <Card className="p-5 text-sm text-amber-900">{G.leaderAccount}</Card>
        ) : (
          <>
            <Card className="flex flex-col gap-1.5 p-5 text-sm">
              <h2 className="font-bold">{G.impact}</h2>
              <p>{fmt(G.impactCommittees, p.committees.length, leads)}</p>
              {m.deputyOf ? <p>{G.impactDeputy}</p> : null}
              <p>{fmt(G.impactWork, p.work.committeeTasks.length, p.work.planTasks.length, p.work.tickets, p.work.marketingTasks, p.work.invites)}</p>
            </Card>
            <Card className="p-5">
              <ActionForm
                action={terminateMembershipAction}
                submits={[{ label: G.terminate }]}
                pendingLabel={G.terminating}
                theme={theme}
                confirm={{ title: G.terminateTitle, body: G.terminateBody, confirmLabel: G.terminate }}
              >
                <input type="hidden" name="memberId" value={m.id} />
                <input type="hidden" name="confirm" value="1" />
                <Field label={G.replacementFor}>
                  <select name="replacementId" defaultValue="" required={p.openCount > 0} className={inputCls}>
                    <option value="">{G.choose}</option>
                    {p.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={G.reason}>
                  <textarea name="reason" required maxLength={300} rows={3} className={textareaCls} />
                </Field>
              </ActionForm>
            </Card>
            <Card className="p-5">
              {m.state === "suspended" ? (
                <ActionForm action={reinstateMemberAction} submits={[{ label: G.reinstate, variant: "outline" }]} pendingLabel={G.applying} theme={theme}>
                  <input type="hidden" name="memberId" value={m.id} />
                </ActionForm>
              ) : (
                <ActionForm
                  action={suspendMemberAction}
                  submits={[{ label: G.suspend, variant: "outline" }]}
                  pendingLabel={G.suspending}
                  theme={theme}
                  confirm={{ title: G.suspend, body: G.suspendBody, confirmLabel: G.suspend }}
                >
                  <input type="hidden" name="memberId" value={m.id} />
                  <Field label={G.reason}>
                    <textarea name="reason" required maxLength={300} rows={2} className={textareaCls} />
                  </Field>
                </ActionForm>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
