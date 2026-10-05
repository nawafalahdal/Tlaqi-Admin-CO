import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepOverdueRequests } from "@/lib/workflow";
import { themeFromColor } from "@/lib/brand";
import { AppHeader, Card } from "@/components/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { ApprovalRow } from "../../ApprovalRow";
import { NeedsMeetingRow } from "./NeedsMeetingRow";
import { RequestCard } from "./RequestCard";

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
  const isOwnDept = session.user.role === "department_admin" && session.user.departmentSlug === slug;
  if (!isSuperAdmin && !isOwnDept) redirect("/admin");

  const department = await prisma.department.findUnique({ where: { slug } });
  if (!department) notFound();

  await sweepOverdueRequests(department.id);

  const [approvalQueue, needsMeeting, requests] = await Promise.all([
    prisma.member.findMany({
      where: { departmentId: department.id, approvalStatus: "pending_review", testStatus: "passed" },
      include: { department: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.member.findMany({
      where: { departmentId: department.id, approvalStatus: "pending_review", testStatus: "failed" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.request.findMany({
      where: { targetDepartmentId: department.id },
      include: { linkedMember: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const theme = themeFromColor(department.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName={`أدمن ${department.name}`} userName={session.user.name ?? ""}>
        <LogoutButton color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-5 py-8 flex flex-col gap-10">
        {approvalQueue.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-bold">بانتظار الاعتماد النهائي</h2>
            <div className="flex flex-col gap-3">
              {approvalQueue.map((m) => (
                <ApprovalRow
                  key={m.id}
                  member={{
                    id: m.id,
                    fullName: m.fullName,
                    email: m.email,
                    testScore: m.testScore,
                    departmentName: department.name,
                    departmentColor: department.colorHex,
                  }}
                />
              ))}
            </div>
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
      </main>
    </div>
  );
}
