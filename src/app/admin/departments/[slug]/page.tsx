import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepOverdueRequests } from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import { TicketCard } from "../../tickets/TicketCard";
import { themeFromColor } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { ApprovalQueue } from "../../ApprovalQueue";
import { NeedsMeetingRow } from "./NeedsMeetingRow";
import { RequestCard } from "./RequestCard";
import { MemberInviteForm } from "./MemberInviteForm";
import { MemberRoster } from "./MemberRoster";
import Link from "next/link";

const COLUMNS: { status: "new" | "in_progress" | "done" | "overdue"; label: string }[] = [
  { status: "new", label: "جديد" },
  { status: "in_progress", label: "قيد التنفيذ" },
  { status: "overdue", label: "متأخر" },
  { status: "done", label: "منجز" },
];

export default async function DepartmentBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session) redirect("/login");

  const isSuperAdmin = session.user.role === "super_admin";
  const isExecutive = session.user.role === "executive";
  const isOwnDept = session.user.role === "department_admin" && session.user.departmentSlug === slug;
  if (!isSuperAdmin && !isExecutive && !isOwnDept) redirect("/admin");

  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();

  await sweepOverdueRequests(department.id);
  await sweepTicketEscalation();

  const [approvalQueue, needsMeeting, requests, activeMembers, tickets] = await Promise.all([
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "pending_review",
        testStatus: "passed",
        invite: { targetRole: "member" },
      },
      include: { department: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "pending_review",
        testStatus: "failed",
        invite: { targetRole: "member" },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.request.findMany({
      where: { targetDepartmentId: department.id },
      include: { linkedMember: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.member.findMany({
      where: {
        departmentId: department.id,
        approvalStatus: "approved",
        isActive: true,
        invite: { targetRole: "member" },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.ticket.findMany({
      where: {
        status: { in: ["open", "in_progress"] },
        OR: [
          { targetDepartmentId: department.id },
          { stage: "lead_escalation", member: { departmentId: department.id } },
        ],
      },
      include: { member: true, targetDepartment: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const theme = themeFromColor(department.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={`أدمن ${department.name}`} userName={session.user.name ?? ""}>
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-5 py-8 flex flex-col gap-10">
        <section>
          <h1 className="mb-1 text-xl font-bold">دعوة عضو جديد</h1>
          <p className="mb-4 text-sm text-black/50">
            حصراً أدمن هذا القسم يملك هذا الإجراء — حوكمة صارمة بالتسلسل
          </p>
          {isOwnDept ? (
            <Card className="p-6">
              <MemberInviteForm departmentId={department.id} theme={theme} />
            </Card>
          ) : (
            <Card className="p-6 text-sm text-black/50">
              للعرض فقط — إصدار دعوة عضو هنا متاح لأدمن {department.name} حصراً.
            </Card>
          )}
        </section>

        {approvalQueue.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-bold">بانتظار الاعتماد النهائي</h2>
            <ApprovalQueue
              themeColorHex={department.colorHex}
              members={approvalQueue.map((m) => ({
                id: m.id,
                fullName: m.fullName,
                email: m.email,
                testScore: m.testScore,
                departmentName: department.name,
                departmentColor: department.colorHex,
              }))}
            />
          </section>
        )}

        {needsMeeting.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-bold">بحاجة إلى اجتماع شرح</h2>
            <div className="flex flex-col gap-3">
              {needsMeeting.map((m) => (
                <NeedsMeetingRow
                  key={m.id}
                  member={{ id: m.id, fullName: m.fullName, email: m.email, testScore: m.testScore }}
                  theme={theme}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-4 text-lg font-bold">الأعضاء النشطون ({activeMembers.length})</h2>
          <MemberRoster
            theme={theme}
            members={activeMembers.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              jobTitle: m.jobTitle,
              warningsCount: m.warningsCount,
            }))}
          />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">تذاكر الأعضاء ({tickets.length})</h2>
          <p className="mb-4 -mt-3 text-xs text-black/40">
            طلبات مباشرة من القسم المستهدف ومن تذاكر مصعّدة إليك كقائد قسم العضو
          </p>
          {tickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">لا توجد تذاكر مفتوحة</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {tickets.map((t) => (
                <TicketCard
                  key={t.id}
                  theme={theme}
                  ticket={{
                    id: t.id,
                    subject: t.subject,
                    description: t.description,
                    status: t.status,
                    stage: t.stage,
                    stageDueAt: t.stageDueAt.toISOString(),
                    resolutionNote: t.resolutionNote,
                    memberName: t.member.fullName,
                    targetDepartmentName: t.targetDepartment.name,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">طلبات القسم</h2>
          <div className="grid gap-4 md:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = requests.filter((r) => r.status === col.status);
              return (
                <div key={col.status} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-sm font-bold text-black/60">{col.label}</h3>
                    <span className="text-xs text-black/30">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {items.length === 0 && (
                      <Card className="p-4 text-center text-xs text-black/30">لا شيء هنا</Card>
                    )}
                    {items.map((r) => (
                      <RequestCard
                        key={r.id}
                        theme={theme}
                        request={{
                          id: r.id,
                          type: r.type,
                          status: r.status,
                          note: r.note,
                          dueDate: r.dueDate ? r.dueDate.toISOString() : null,
                          linkedMemberName: r.linkedMember?.fullName ?? null,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">اختبار قبول أعضاء {department.name}</h2>
              <p className="text-xs text-black/40">الأسئلة التي يجتازها مرشحو هذا القسم</p>
            </div>
            <Link
              href={`/admin/departments/${slug}/test`}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.accentDark }}
            >
              تعديل الأسئلة
            </Link>
          </Card>
        </section>
      </main>
    </div>
  );
}
