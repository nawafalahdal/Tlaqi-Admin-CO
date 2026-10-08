import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { BackButton } from "@/components/BackButton";
import { DataTable } from "@/components/DataTable";
import { AccountStageBadge } from "@/components/AccountStageBadge";
import { CandidateWindow } from "@/components/CandidateWindow";
import {
  ExecutiveInviteForm,
  DeptAdminInviteForm,
  OperationsOfficerInviteForm,
} from "../LeadershipInviteForms";
import { formatDate } from "@/lib/format";
import {
  CANDIDATE_EXPIRY_REASON,
  candidateHoursLeft,
  findRoleSeatHolder,
  sweepExpiredCandidateAccounts,
} from "@/lib/workflow";
import { SeatOccupied } from "@/components/SeatOccupied";
import { getLocale, getDictionary } from "@/i18n/server";

export default async function AdminInvitesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin" && session.user.role !== "executive") {
    redirect("/admin");
  }

  const isSuperAdmin = session.user.role === "super_admin";

  await sweepExpiredCandidateAccounts();

  const [departments, invites, execSeat, opsSeat] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.invite.findMany({
      include: { department: true, member: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    findRoleSeatHolder("executive", null),
    findRoleSeatHolder("operations_officer", null),
  ]);

  // المناصب الفردية: يُعرض شاغلها بدل النموذج، فلا يملأ أحد حقولاً ستُرفض
  const deptSeats = new Map(
    (
      await Promise.all(
        departments.map(async (d) => [d.id, await findRoleSeatHolder("department_admin", d.id)] as const)
      )
    ).filter(([, holder]) => holder)
  );

  function seatLine(holder: { fullName: string; kind: string } | null) {
    if (!holder) return "";
    return (holder.kind === "active" ? ts.occupiedBy : ts.occupiedCandidate).replace(
      "{name}",
      holder.fullName
    );
  }

  const dict = getDictionary(await getLocale());
  const t = dict.invitesPage;
  const ta = dict.admin;
  const tw = dict.candidateWindow;
  const ts = dict.seats;
  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? ta.founderRole : ta.ceoRole}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8">
        <div>
          <BackButton fallbackHref="/admin" />
          <h1 className="text-lg font-bold sm:text-xl">{t.title}</h1>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {ts.governance}
          </p>
          <p className="mt-1 text-sm text-black/50">
            {t.subtitle}
          </p>
        </div>

        {isSuperAdmin && (
          <section>
            <h2 className="mb-1 text-base font-bold sm:text-lg">{ta.createExecTitle}</h2>
            <p className="mb-3 text-sm text-black/50">
              {ta.createExecSubtitle}
            </p>
            {execSeat ? (
              <SeatOccupied
                title={ts.occupiedTitle}
                holderLine={seatLine(execSeat)}
                hint={ts.occupiedHint}
              />
            ) : (
              <Card className="p-4 sm:p-6">
                <ExecutiveInviteForm />
              </Card>
            )}
          </section>
        )}

        {/* مسؤول التشغيل ذراع التنفيذي: بنك أسئلته له، ودعوته له.
            ودعوةُ المؤسس له تجعل التنفيذي مسؤولاً عمّن لم يَختَره. */}
        {!isSuperAdmin && (
        <section>
          <h2 className="mb-1 text-base font-bold sm:text-lg">{t.createOpsTitle}</h2>
          <p className="mb-3 text-sm text-black/50">
            {t.createOpsSubtitle}
          </p>
          {opsSeat ? (
            <SeatOccupied
              title={ts.occupiedTitle}
              holderLine={seatLine(opsSeat)}
              hint={ts.occupiedHint}
            />
          ) : (
            <Card className="p-4 sm:p-6">
              <OperationsOfficerInviteForm />
            </Card>
          )}
        </section>
        )}

        <section>
          <h2 className="mb-1 text-base font-bold sm:text-lg">{ta.createLeadTitle}</h2>
          <p className="mb-3 text-sm text-black/50">
            {ta.createLeadSubtitle}
          </p>
          <Card className="p-4 sm:p-6">
            <DeptAdminInviteForm
              departments={departments.filter((d) => !deptSeats.has(d.id))}
            />
          </Card>
          {deptSeats.size > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-black/40">
              {ts.occupiedHint}
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-bold sm:text-lg">{t.issuedTitle}</h2>
          <p className="mb-2 -mt-2 text-xs text-black/40">{t.issuedHint}</p>
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {tw.governanceNote}
          </p>
          <DataTable
            emptyLabel={ta.invitesEmpty}
            columns={[
              { key: "name", label: ta.colName, primary: true },
              { key: "track", label: ta.colTrack },
              { key: "status", label: t.colAccountStatus },
              { key: "createdAt", label: ta.colIssuedAt },
              { key: "firstLogin", label: t.colWindow },
            ]}
            rows={invites.map((inv) => ({
              id: inv.id,
              cells: {
                name: inv.fullName,
                track: `${dict.roles[inv.targetRole]}${inv.department ? ` — ${inv.department.name}` : ""}`,
                status: (
                  <AccountStageBadge
                    approvalStatus={inv.member?.approvalStatus ?? null}
                    testStatus={inv.member?.testStatus ?? null}
                  />
                ),
                createdAt: formatDate(inv.createdAt),
                firstLogin: (
                  <CandidateWindow
                    firstLoginAt={inv.member?.firstLoginAt?.toISOString() ?? null}
                    hoursLeft={
                      inv.member?.credentialsIssuedAt
                        ? candidateHoursLeft(inv.member.credentialsIssuedAt)
                        : null
                    }
                    lapsed={
                      !!inv.member &&
                      !inv.member.isActive &&
                      inv.member.exitReason === CANDIDATE_EXPIRY_REASON
                    }
                    notApplicable={
                      !inv.member ||
                      !inv.member.credentialsIssuedAt ||
                      inv.member.approvalStatus === "approved"
                    }
                  />
                ),
              },
            }))}
          />
        </section>
      </main>
    </div>
  );
}
