import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepOverdueRequests } from "@/lib/workflow";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { InviteForm } from "./InviteForm";
import { ApprovalRow } from "./ApprovalRow";
import { formatDate } from "@/lib/format";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  welcome_banner: "بانر ترحيبي",
  custom_design: "تصميم مخصص",
  dept_contact: "تواصل قسم",
  meeting: "اجتماع شرح",
};

export default async function AdminPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (session.user.role === "department_admin" && session.user.departmentSlug) {
    redirect(`/admin/departments/${session.user.departmentSlug}`);
  }

  await sweepOverdueRequests();

  const [departments, pendingMembers, requests, invites] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.member.findMany({
      where: { approvalStatus: "pending_review", testStatus: "passed" },
      include: { department: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.request.findMany({
      include: { targetDepartment: true, linkedMember: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.invite.findMany({
      include: { department: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader theme={theme} roleName="الإدارة العليا" userName={session.user.name ?? ""}>
        <LogoutButton color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-5 py-8 flex flex-col gap-8">
        <section>
          <h1 className="mb-1 text-xl font-bold">إصدار دعوة جديدة</h1>
          <p className="mb-4 text-sm text-black/50">
            كل دعوة مربوطة باسم وإيميل شخص واحد بعينه — لا رابط عام
          </p>
          <Card className="p-6">
            <InviteForm departments={departments} />
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">بانتظار الاعتماد النهائي</h2>
          {pendingMembers.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">
              لا يوجد مرشحون بانتظار الاعتماد حالياً
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {pendingMembers.map((m) => (
                <ApprovalRow
                  key={m.id}
                  member={{
                    id: m.id,
                    fullName: m.fullName,
                    email: m.email,
                    testScore: m.testScore,
                    departmentName: m.department.name,
                    departmentColor: m.department.colorHex,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">أحدث الدعوات الصادرة</h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-start text-xs text-black/40">
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">القسم</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">تاريخ الإصدار</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 font-medium">{inv.fullName}</td>
                    <td className="px-4 py-3 text-black/60">{inv.department.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3 text-black/50">
                      {formatDate(inv.createdAt)}
                    </td>
                  </tr>
                ))}
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-black/40">
                      لا توجد دعوات بعد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">الطلبات بين الأقسام — نظرة شاملة</h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-start text-xs text-black/40">
                  <th className="px-4 py-3 font-medium">النوع</th>
                  <th className="px-4 py-3 font-medium">القسم المستهدف</th>
                  <th className="px-4 py-3 font-medium">متعلق بـ</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">المهلة</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 font-medium">{REQUEST_TYPE_LABELS[r.type]}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 text-black/70"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: r.targetDepartment.colorHex }}
                        />
                        {r.targetDepartment.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-black/60">{r.linkedMember?.fullName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-black/50">
                      {r.dueDate ? formatDate(r.dueDate) : "—"}
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-black/40">
                      لا توجد طلبات بعد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </section>
      </main>
    </div>
  );
}
