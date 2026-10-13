import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { approverFor } from "@/lib/notify";
import {
  sendTerminationRequestEmail,
  sendTerminationDecisionEmail,
} from "@/lib/email";
import { appBaseUrl } from "@/lib/emailBrand";
import { accountRoleLabel } from "@/lib/testTracks";
import { syncMemberLifecycleRow } from "@/lib/workflow";

/** «طلب إنهاء فترة الإدارة في تَـــلاقِ».
 *
 *  ثلاث قواعد تحكم هذا الملفّ:
 *
 *  ١. **الرفع لا يُعطّل.** من طلب الإنهاء يبقى على عمله حتى يُقرّر
 *     مسؤولُه وتحلّ مهلته. ولو عُطِّل بالرفع لأمكن أن يُخرِج نفسَه
 *     بضغطةٍ بلا مراجعة، ولصار الطلب عقوبةً يخشاها من يحقّ له طلبُه.
 *
 *  ٢. **اللقاء ليس قراراً.** قد يُقنعه مسؤولُه بالبقاء أو يتفهّم
 *     فيوافق — وفي الحالتين القرار يأتي بعد اللقاء لا معه.
 *
 *  ٣. **الخروج يقع بالموافقة وحلول التاريخ، لا بأحدهما.** فالموافقة
 *     على إنهاءٍ بعد شهر لا تُنهيه اليوم.
 */

/** صيغة التكليف كما تُقرأ وتُسجَّل */
function assignmentLabelOf(m: {
  department: { name: string } | null;
  invite: { targetRole: string };
  jobTitle: string | null;
}): string {
  const role = accountRoleLabel(m.invite.targetRole);
  const where = m.department?.name;
  const job = m.jobTitle?.trim();
  return [job || role, where].filter(Boolean).join(" — ");
}

/** سجلّ العضو من جلسةٍ أيّاً كان دورها.
 *
 *  العضو يدخل بسجلّ `Member`، والقائد يدخل بسجلّ `User` وله `Member`
 *  باقٍ من يوم ترشّحه. فيُوصَل بالبريد — وهو فريدٌ في الجدولين. */
export async function memberForSession(session: {
  user: { id: string; role: string; email?: string | null };
}) {
  if (session.user.role === "member") {
    return prisma.member.findUnique({
      where: { id: session.user.id },
      include: { department: true, invite: true },
    });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!user) return null;
  return prisma.member.findUnique({
    where: { email: user.email },
    include: { department: true, invite: true },
  });
}

/** الطلب الحيّ لهذا العضو — واحدٌ لا أكثر */
export async function openRequestFor(memberId: string) {
  return prisma.terminationRequest.findFirst({
    where: { memberId, status: { in: ["submitted", "meeting_requested", "approved"] } },
    orderBy: { submittedAt: "desc" },
  });
}

/** يرفع العضو طلبه.
 *
 *  ولا يُنشئ ثانياً لمن له طلبٌ حيّ: طلبان لشخصٍ واحد يُنتجان قرارين
 *  وشهادتين. */
export async function submitTerminationRequest(opts: {
  memberId: string;
  reason: string;
  requestedEndDate: Date | null;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const reason = opts.reason.trim();
  if (reason.length < 10) return { ok: false, reason: "اكتب سبب طلبك بما لا يقلّ عن عشرة أحرف" };

  const member = await prisma.member.findUnique({
    where: { id: opts.memberId },
    include: { department: true, invite: true },
  });
  if (!member) return { ok: false, reason: "السجل غير موجود" };
  if (!member.isActive) return { ok: false, reason: "الحساب غير نشط" };
  if (member.stepDownAt) return { ok: false, reason: "سُجِّلت تنحيتك سابقاً" };

  const open = await openRequestFor(member.id);
  if (open) return { ok: false, reason: "لك طلبٌ قائمٌ لم يُحسم بعد" };

  if (opts.requestedEndDate && opts.requestedEndDate.getTime() < Date.now() - 86400_000) {
    return { ok: false, reason: "التاريخ المقترح لا يكون في الماضي" };
  }

  const created = await prisma.terminationRequest.create({
    data: {
      memberId: member.id,
      assignmentLabel: assignmentLabelOf(member),
      reason,
      requestedEndDate: opts.requestedEndDate,
      status: "submitted",
    },
  });

  // **لا يُعطَّل الحساب هنا.** الرفع ليس خروجاً.

  // يُخبَر مسؤولُه وحده — لا تُعمَّم على الإدارة
  const manager = await approverFor(member.departmentId);
  if (manager.to.length > 0) {
    await sendTerminationRequestEmail({
      to: manager.to,
      memberName: member.fullName,
      memberEmail: member.email,
      assignmentLabel: created.assignmentLabel,
      reason,
      requestedEndDate: opts.requestedEndDate,
      portalUrl: `${appBaseUrl()}/admin/terminations`,
    });
  }

  await appendMemberEvent({
    fullName: member.fullName,
    email: member.email,
    event: "طلب إنهاء فترة الإدارة",
    roleOrDepartment: created.assignmentLabel,
    details:
      `${reason}` +
      (opts.requestedEndDate ? ` — التاريخ المقترح ${opts.requestedEndDate.toISOString().slice(0, 10)}` : "") +
      ` — أُبلِغ: ${manager.because}`,
    at: new Date(),
  });
  await syncMemberLifecycleRow(member.id);

  return { ok: true, id: created.id };
}

/** من يملك قرار هذا الطلب — نفس من يملك اعتماد العضو */
export async function canDecide(
  request: { memberId: string },
  session: { user: { id: string; role: string; departmentId?: string | null } }
): Promise<boolean> {
  if (session.user.role === "super_admin" || session.user.role === "executive") return true;
  if (session.user.role !== "department_admin") return false;
  const member = await prisma.member.findUnique({
    where: { id: request.memberId },
    select: { departmentId: true },
  });
  return Boolean(member?.departmentId && member.departmentId === session.user.departmentId);
}

/** قرار المسؤول: موافقة، أو رفضٌ بتفسير، أو طلبُ لقاء.
 *
 *  والقرارات محصورةٌ بـ`where`: قرارانِ متسارعانِ يمرّ أحدهما فقط،
 *  فلا رسالتان ولا شهادتان. */
export async function decideTerminationRequest(opts: {
  requestId: string;
  decision: "approve" | "reject" | "request_meeting";
  note?: string | null;
  /** تاريخ الانتهاء المُثبَت عند الموافقة */
  endDate?: Date | null;
  actorId: string;
  actorName: string;
}): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
  const req = await prisma.terminationRequest.findUnique({
    where: { id: opts.requestId },
    include: { member: { include: { department: true, invite: true } } },
  });
  if (!req) return { ok: false, reason: "الطلب غير موجود" };

  if (opts.decision === "request_meeting") {
    // اللقاء يُطلب على طلبٍ لم يُحسم — ولا يُحسمه
    const written = await prisma.terminationRequest.updateMany({
      where: { id: req.id, status: { in: ["submitted", "meeting_requested"] } },
      data: {
        status: "meeting_requested",
        meetingRequestedAt: new Date(),
        meetingNote: opts.note?.trim() || null,
      },
    });
    if (written.count === 0) return { ok: false, reason: "حُسم الطلب — لا يُطلب لقاءٌ بعده" };
  } else if (opts.decision === "reject") {
    if (!opts.note?.trim()) return { ok: false, reason: "الرفض يحتاج تفسيراً مكتوباً" };
    const written = await prisma.terminationRequest.updateMany({
      where: { id: req.id, status: { in: ["submitted", "meeting_requested"] } },
      data: {
        status: "rejected",
        decidedAt: new Date(),
        decidedById: opts.actorId,
        decidedByName: opts.actorName,
        decisionNote: opts.note.trim(),
      },
    });
    if (written.count === 0) return { ok: false, reason: "حُسم الطلب قبل قليل" };
  } else {
    const endDate = opts.endDate ?? req.requestedEndDate ?? new Date();
    const written = await prisma.terminationRequest.updateMany({
      where: { id: req.id, status: { in: ["submitted", "meeting_requested"] } },
      data: {
        status: "approved",
        decidedAt: new Date(),
        decidedById: opts.actorId,
        decidedByName: opts.actorName,
        decisionNote: opts.note?.trim() || null,
        requestedEndDate: endDate,
      },
    });
    if (written.count === 0) return { ok: false, reason: "حُسم الطلب قبل قليل" };
  }

  const fresh = await prisma.terminationRequest.findUniqueOrThrow({ where: { id: req.id } });

  // يُخبَر صاحب الطلب بقرار طلبه — فهو صاحب الشأن
  await sendTerminationDecisionEmail({
    to: req.member.email,
    memberName: req.member.fullName,
    assignmentLabel: req.assignmentLabel,
    decision: opts.decision,
    note: opts.note?.trim() || null,
    endDate: fresh.requestedEndDate,
    byName: opts.actorName,
  });

  await appendMemberEvent({
    fullName: req.member.fullName,
    email: req.member.email,
    event:
      opts.decision === "approve"
        ? "موافقة على إنهاء فترة الإدارة"
        : opts.decision === "reject"
          ? "رفض طلب إنهاء فترة الإدارة"
          : "طلب لقاء قبل القرار",
    roleOrDepartment: req.assignmentLabel,
    details:
      `${opts.actorName}` +
      (opts.note?.trim() ? `: ${opts.note.trim()}` : "") +
      (opts.decision === "approve" && fresh.requestedEndDate
        ? ` — تاريخ الانتهاء ${fresh.requestedEndDate.toISOString().slice(0, 10)}`
        : "") +
      (opts.decision === "request_meeting" ? " — وليس قراراً بالموافقة ولا بالرفض" : ""),
    at: new Date(),
  });
  await syncMemberLifecycleRow(req.memberId);

  return { ok: true, status: fresh.status };
}

/** يسحب صاحبُ الطلب طلبَه قبل القرار */
export async function withdrawTerminationRequest(opts: {
  requestId: string;
  memberId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const written = await prisma.terminationRequest.updateMany({
    where: {
      id: opts.requestId,
      // صاحبُه وحده يسحبه — المعرّف في `where` لا في فحصٍ قبله
      memberId: opts.memberId,
      status: { in: ["submitted", "meeting_requested"] },
    },
    data: { status: "withdrawn", decidedAt: new Date(), decidedByName: "سحبه صاحبه" },
  });
  if (written.count === 0) return { ok: false, reason: "لا طلب قابلٌ للسحب" };
  return { ok: true };
}

/** الكنس: من وُوفق على إنهائه وحلّ تاريخُه يُنفَّذ خروجه.
 *
 *  **وهذا الموضع الوحيد الذي يُنفِّذ الخروج.** فلا الموافقة وحدها
 *  تُنهي (قد تكون لتاريخٍ بعد شهر)، ولا حلول التاريخ وحده (قد يكون
 *  الطلب مرفوضاً). و`stepDownMember` يحرس التكرار بنفسه. */
export async function sweepEffectiveTerminations(): Promise<number> {
  const due = await prisma.terminationRequest.findMany({
    where: {
      status: "approved",
      requestedEndDate: { lte: new Date() },
    },
    include: { member: { include: { department: true, invite: true } } },
  });

  let done = 0;
  for (const req of due) {
    // الشرط في `where`: كنسانِ متوازيانِ يُنفّذ أحدهما
    const claimed = await prisma.terminationRequest.updateMany({
      where: { id: req.id, status: "approved" },
      data: { status: "effective", effectiveAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const { stepDownMember } = await import("@/lib/offboarding");
    const res = await stepDownMember({
      memberId: req.memberId,
      byName: req.decidedByName ?? "قرار إنهاء فترة الإدارة",
      reason: `إنهاء فترة الإدارة بطلب صاحبه: ${req.reason}`,
      endDate: req.requestedEndDate ?? new Date(),
    });

    if (!res.ok) {
      // سُجِّلت تنحيته من مسارٍ آخر — الطلب يبقى `effective` ولا يُعاد
      await appendMemberEvent({
        fullName: req.member.fullName,
        email: req.member.email,
        event: "تنفيذ إنهاء فترة الإدارة",
        roleOrDepartment: req.assignmentLabel,
        details: `لم تُسجَّل التنحية: ${res.reason} — لعلّها سُجِّلت من مسارٍ آخر`,
        at: new Date(),
      });
      continue;
    }
    done += 1;
  }
  return done;
}

/** الطلبات التي تنتظر قرار هذا المسؤول */
export async function requestsAwaiting(session: {
  user: { role: string; departmentId?: string | null };
}) {
  const where =
    session.user.role === "super_admin" || session.user.role === "executive"
      ? {}
      : { member: { departmentId: session.user.departmentId ?? "—" } };

  return prisma.terminationRequest.findMany({
    where: {
      AND: [{ status: { in: ["submitted", "meeting_requested", "approved"] as const } }, where],
    },
    include: { member: { include: { department: true, invite: true } } },
    orderBy: { submittedAt: "asc" },
  });
}
