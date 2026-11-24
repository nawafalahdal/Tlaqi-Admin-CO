import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROSTER_MEMBER_WHERE } from "@/lib/roster";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { formatDate } from "@/lib/format";
import { assessableTracks, assessmentRegister, canAssignAssessments, PURPOSE_LABEL } from "@/lib/assessments";
import { accountRoleLabel } from "@/lib/testTracks";
import { AssignForm } from "./AssignForm";
import { CancelAssessment } from "./CancelAssessment";


const STATUS_LABEL: Record<string, string> = { assigned: "لم يُسلَّم", passed: "مجتاز", failed: "غير مجتاز", cancelled: "ملغى" };

/** **اختباراتُ الأعضاء الحاليين** (البند ١.٢) — يكلّف بها قائدُ الإدارة العليا (الرئيسُ التنفيذي) بسببٍ مكتوب، ويطّلع عليها
 *  المؤسسُ والرئيسُ التنفيذي. للتقييم والاطّلاع وحدهما: لا تغيّر عضويةً ولا صلاحيةً ولا تعيد فتح اعتماد (ق٧). */
export async function AssessmentsView() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fsenior%2Fassessments");
  const canAssign = await canAssignAssessments(session);
  const canView = canAssign || session.user.role === "super_admin" || session.user.role === "executive";
  if (!canView) redirect(session.user.role === "member" ? "/member" : "/admin");

  const [tracks, register, members, users] = await Promise.all([
    canAssign ? assessableTracks() : Promise.resolve([]),
    assessmentRegister(),
    canAssign
      ? prisma.member.findMany({
          // الأعضاءُ بصفتهم أعضاء (`ROSTER_MEMBER_WHERE`): القائدُ المرقّى يُكلَّف بحسابه الإداري أدناه — لا بسجلّ ترشّحه التوأم مرّةً ثانية
          where: { ...ROSTER_MEMBER_WHERE, terminatedAt: null },
          select: { id: true, fullName: true, department: { select: { name: true } } },
          orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
    canAssign
      ? prisma.user.findMany({
          where: { isActive: true, role: { not: "super_admin" }, id: { not: session.user.id } },
          select: { id: true, fullName: true, role: true },
          orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const people = [
    ...members.map((m) => ({ value: `member:${m.id}`, label: `${m.fullName} — ${m.department?.name ?? "عضو"}` })),
    ...users.map((u) => ({ value: `user:${u.id}`, label: `${u.fullName} — ${accountRoleLabel(u.role)}` })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="اختبارات الأعضاء الحاليين"
        description="تقييمٌ لعضوٍ قائم على حسابه هو — بلا دعوةٍ ولا حسابٍ جديد. يُسجَّل سببُه ومن كلّف به، وتُحفظ محاولاتُه ونتيجتُه، ولا يغيّر عضويةً ولا صلاحيةً ولا يعيد فتح اعتماد."
      />
      {canAssign ? (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-bold">تكليفٌ جديد</h2>
          {tracks.length === 0 ? (
            <p className="text-sm text-black/50">لا بنكَ أسئلةٍ فيه أسئلة بعد.</p>
          ) : (
            <AssignForm people={people} tracks={tracks} />
          )}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-black/60">للاطّلاع — التكليفُ لقائد الإدارة العليا.</Card>
      )}
      <div>
        <h2 className="mb-3 text-base font-bold">سجلُّ الاختبارات ({register.length})</h2>
        <DataTable
          emptyLabel="لا اختباراتٍ بعد"
          columns={[
            { key: "who", label: "صاحبُه", primary: true },
            { key: "purpose", label: "الغرض" },
            { key: "status", label: "الحالة" },
            { key: "score", label: "الدرجة" },
            { key: "reason", label: "السبب" },
            { key: "by", label: "كلّف به" },
            { key: "actions", label: "" },
          ]}
          rows={register.map((a) => ({
            id: a.id,
            cells: {
              who: (
                <span className="min-w-0">
                  <span className="block font-bold">{a.member?.fullName ?? a.user?.fullName ?? "—"}</span>
                  <span className="block text-[11px] text-black/45">
                    {a.member ? a.member.department?.name ?? "عضو" : a.user ? accountRoleLabel(a.user.role) : ""}
                  </span>
                </span>
              ),
              purpose: a.purpose === "senior_position" ? `${PURPOSE_LABEL.senior_position}: ${a.seniorPosition?.titleAr ?? ""}` : PURPOSE_LABEL.evaluation,
              status: `${STATUS_LABEL[a.status] ?? a.status}${a.completedAt ? ` — ${formatDate(a.completedAt)}` : ""}${a.cancelReason ? ` (${a.cancelReason})` : ""}`,
              score: a.score == null ? "—" : `${a.score}% (${a._count.attempts} محاولة)`,
              reason: <span className="text-xs leading-relaxed">{a.reason}</span>,
              by: `${a.createdByName} — ${formatDate(a.createdAt)}`,
              actions: canAssign && a.status === "assigned" && a.purpose === "evaluation" ? <CancelAssessment id={a.id} /> : "",
            },
          }))}
        />
      </div>
    </div>
  );
}
