import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sweepOverdueRequests, REQUEST_TYPE_LABELS } from "@/lib/workflow";
import { sweepTicketEscalation } from "@/lib/tickets";
import { TicketCard } from "./tickets/TicketCard";
import { themeFromColor, SUPER_ADMIN_THEME, BRAND } from "@/lib/brand";
import { ROLE_LABELS } from "@/lib/testTracks";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { ExecutiveInviteForm, DeptAdminInviteForm, OperationsOfficerInviteForm } from "./LeadershipInviteForms";
import { ApprovalQueue } from "./ApprovalQueue";
import { formatDate } from "@/lib/format";
import Link from "next/link";

export default async function AdminPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (session.user.role === "department_admin" && session.user.departmentSlug) {
    redirect(`/admin/departments/${session.user.departmentSlug}`);
  }
  if (session.user.role === "operations_officer") redirect("/admin/operations");
  if (session.user.role === "member") redirect("/member");

  const isSuperAdmin = session.user.role === "super_admin";

  await sweepOverdueRequests();
  await sweepTicketEscalation();

  const [departments, leadershipQueue, memberQueue, requests, invites, escalatedTickets] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.member.findMany({
      where: {
        approvalStatus: "pending_review",
        testStatus: "passed",
        invite: { targetRole: { in: ["department_admin", "operations_officer", "executive"] } },
      },
      include: { department: true, invite: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.member.findMany({
      where: {
        approvalStatus: "pending_review",
        testStatus: "passed",
        invite: { targetRole: "member" },
      },
      include: { department: true, invite: true },
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
      take: 10,
    }),
    prisma.ticket.findMany({
      where: { status: { in: ["open", "in_progress"] }, stage: "ceo_escalation" },
      include: { member: true, targetDepartment: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

  return (
    <div className="min-h-screen bg-[#FAF8F4]">
      <AppHeader
        theme={theme}
        roleName={isSuperAdmin ? "الفاونڈر — الإدارة العليا" : "الإدارة التنفيذية (CEO)"}
        userName={session.user.name ?? ""}
      >
        <HeaderActions color={theme.text} />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-5 py-8 flex flex-col gap-8">
        {isSuperAdmin && (
          <section>
            <h1 className="mb-1 text-xl font-bold">إنشاء حساب تنفيذي (CEO)</h1>
            <p className="mb-4 text-sm text-black/50">
              يحصل على صلاحية إنشاء حسابات قادة الأقسام — لا يمكنه إنشاء حساب تنفيذي آخر
            </p>
            <Card className="p-6">
              <ExecutiveInviteForm />
            </Card>
          </section>
        )}

        <section>
          <h2 className="mb-1 text-lg font-bold">إنشاء حساب مسؤول تشغيل</h2>
          <p className="mb-4 text-sm text-black/50">
            يطّلع على كل التذاكر والطلبات بتواريخها عبر كل الأقسام، ويرسل تذكيرات — بدون صلاحية حل التذاكر نفسها
          </p>
          <Card className="p-6">
            <OperationsOfficerInviteForm />
          </Card>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-bold">إنشاء حساب قائد قسم</h2>
          <p className="mb-4 text-sm text-black/50">
            حوكمة صارمة: هذا الحساب وحده من يملك دعوة أعضاء جدد داخل قسمه
          </p>
          <Card className="p-6">
            <DeptAdminInviteForm departments={departments} />
          </Card>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">تذاكر مصعّدة إلى الإدارة التنفيذية ({escalatedTickets.length})</h2>
          <p className="mb-4 -mt-3 text-xs text-black/40">
            تذاكر لم تُحل خلال 4 أيام عبر القسم المستهدف ثم قائد قسم العضو — تحتاج تدخلك الآن
          </p>
          {escalatedTickets.length === 0 ? (
            <Card className="p-8 text-center text-sm text-black/40">لا توجد تذاكر متصعّدة حالياً</Card>
          ) : (
            <div className="flex flex-col gap-3">
              {escalatedTickets.map((t) => (
                <TicketCard
                  key={t.id}
                  theme={theme}
                  ticket={{
                    id: t.id,
                    ticketNumber: t.ticketNumber,
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
          <h2 className="mb-4 text-lg font-bold">بانتظار اعتماد القيادة</h2>
          <ApprovalQueue
            emptyMessage="لا يوجد مرشحون لمناصب قيادية بانتظار الاعتماد حالياً"
            members={leadershipQueue.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              testScore: m.testScore,
              departmentName: m.department?.name ?? ROLE_LABELS[m.invite.targetRole],
              departmentColor: m.department?.colorHex ?? BRAND.temptress,
            }))}
          />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">نظرة عامة — اعتماد الأعضاء في الأقسام</h2>
          <p className="mb-4 -mt-3 text-xs text-black/40">
            الاعتماد الأساسي من مسؤولية أدمن كل قسم؛ هذه نظرة شاملة فقط
          </p>
          <ApprovalQueue
            emptyMessage="لا يوجد أعضاء بانتظار الاعتماد"
            members={memberQueue.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              email: m.email,
              testScore: m.testScore,
              departmentName: m.department?.name ?? "—",
              departmentColor: m.department?.colorHex ?? BRAND.temptress,
            }))}
          />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold">أحدث الدعوات الصادرة</h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-start text-xs text-black/40">
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">المسار</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">تاريخ الإصدار</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 font-medium">{inv.fullName}</td>
                    <td className="px-4 py-3 text-black/60">
                      {ROLE_LABELS[inv.targetRole]}
                      {inv.department ? ` — ${inv.department.name}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3 text-black/50">{formatDate(inv.createdAt)}</td>
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
                      <span className="inline-flex items-center gap-1.5 text-black/70">
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
                    <td className="px-4 py-3 text-black/50">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
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

        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">إدارة الحسابات القيادية</h2>
              <p className="text-xs text-black/40">
                مشاكل الدخول: إعادة تعيين كلمة المرور أو تعديل البريد لأي حساب
              </p>
            </div>
            <Link
              href="/admin/accounts"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.accentDark }}
            >
              فتح
            </Link>
          </Card>
        </section>

        {isSuperAdmin && (
          <section>
            <Card className="p-5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold">اختبار الإدارة التنفيذية</h2>
                <p className="text-xs text-black/40">الأسئلة التي يجتازها مرشحو حساب CEO</p>
              </div>
              <Link
                href="/admin/tests/executive"
                className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{ background: theme.surface, color: theme.accentDark }}
              >
                تعديل الأسئلة
              </Link>
            </Card>
          </section>
        )}

        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">اختبار قادة الأقسام</h2>
              <p className="text-xs text-black/40">الأسئلة التي يجتازها مرشحو قيادة أي قسم</p>
            </div>
            <Link
              href="/admin/tests/leads"
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: theme.surface, color: theme.accentDark }}
            >
              تعديل الأسئلة
            </Link>
          </Card>
        </section>

        <section>
          <Card className="p-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold">اختبار مسؤول التشغيل</h2>
              <p className="text-xs text-black/40">الأسئلة التي يجتازها مرشحو مسؤول التشغيل</p>
            </div>
            <Link
              href="/admin/tests/operations"
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
