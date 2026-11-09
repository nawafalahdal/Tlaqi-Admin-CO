import type { RequestType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";

/** **دورةُ حياة طلبات الأقسام** — من الإنشاء إلى الإغلاق، ولكل نوعٍ إغلاقُه الصحيح.
 *
 *  كان الطلبُ يُغلق بحقلٍ واحد (`status = done`) بلا من ولا متى ولا لماذا، ولا يُغلقه
 *  مسؤولُ المتابعة والتشغيل أصلاً، ولا يُغلَق شيءٌ منه بإجراءٍ وقع فعلاً — فبقيت طلباتٌ
 *  مفتوحةً بعد تمام ما طُلب، تتأخّر وتُصعَّد بلا داعٍ. فصار:
 *
 *  | النوع | يُغلَق آلياً حين | يدوياً |
 *  |---|---|---|
 *  | **البنر الترحيبي** (`welcome_banner`) | يقبل مزوّدُ البريد بطاقةَ الانضمام لصاحبها (`stampWelcomeAccepted`) — أو يغادر صاحبُها | لا يُغلق قبل وصول البنر |
 *  | **اجتماع الشرح** بعد عدم الاجتياز (`meeting`) | يُبَتّ في المرشّح: يُعاد فتحُ اختباره أو يُرفض أو يُعتمد أو يغادر | بنتيجة الاجتماع مكتوبةً |
 *  | سائرُ الطلبات | — | بسببٍ مكتوب |
 *
 *  ويُغلقه يدوياً: قائدُ القسم الموجَّه إليه، ومسؤولُ المتابعة والتشغيل، والرئيسُ التنفيذي،
 *  والمؤسس. والإغلاقُ يُسجَّل في الصفّ نفسه (متى، ومن أو «آلياً»، ولماذا) وفي السجل الحي —
 *  ولا يُحذف طلب. */

export type RequestActor = { id: string; name: string; role: string; departmentId: string | null };

export const AUTO_CLOSER = "المنصة — آلياً";
const OPEN = { not: "done" as const };

export function canWorkOnRequest(actor: Pick<RequestActor, "role" | "departmentId">, targetDepartmentId: string): boolean {
  if (actor.role === "super_admin" || actor.role === "executive" || actor.role === "operations_officer") return true;
  return actor.role === "department_admin" && actor.departmentId === targetDepartmentId;
}

/** هل وصل البنرُ صاحبَه (أو لم يعد يُراسَل)؟ — شرطُ إغلاق طلب البنر */
function bannerSettled(m: {
  welcomeEmailSentAt: Date | null;
  isActive: boolean;
  terminatedAt: Date | null;
  noFurtherEmail: boolean;
} | null) {
  if (!m) return { ok: true, why: "صاحبُه لم يعد في المنصة" };
  if (m.welcomeEmailSentAt) return { ok: true, why: `وصل البنر الترحيبي إلى مزوّد البريد في ${m.welcomeEmailSentAt.toISOString().slice(0, 10)}` };
  if (!m.isActive || m.terminatedAt || m.noFurtherEmail) return { ok: true, why: "غادر صاحبُه — لا يُراسَل" };
  return { ok: false, why: "" };
}

/** يبدأ العمل على الطلب (جديد ← قيد التنفيذ) */
export async function startRequest(actor: RequestActor, requestId: string) {
  const r = await prisma.request.findUnique({ where: { id: requestId }, select: { targetDepartmentId: true, status: true } });
  if (!r) return { ok: false as const, reason: "الطلب غير موجود" };
  if (!canWorkOnRequest(actor, r.targetDepartmentId)) return { ok: false as const, reason: "ليس لك العملُ على هذا الطلب" };
  const w = await prisma.request.updateMany({ where: { id: requestId, status: { in: ["new", "overdue"] } }, data: { status: "in_progress" } });
  return w.count ? { ok: true as const } : { ok: false as const, reason: "الطلب ليس جديداً — حدّث الصفحة" };
}

/** **الإغلاقُ اليدوي** — بشرط نوعه، ويُسجَّل من أغلق ومتى ولماذا */
export async function closeRequest(
  actor: RequestActor,
  requestId: string,
  rawNote: string | null | undefined
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      targetDepartment: { select: { name: true } },
      linkedMember: {
        select: { id: true, fullName: true, email: true, welcomeEmailSentAt: true, isActive: true, terminatedAt: true, noFurtherEmail: true },
      },
    },
  });
  if (!r) return { ok: false, reason: "الطلب غير موجود" };
  if (!canWorkOnRequest(actor, r.targetDepartmentId)) return { ok: false, reason: "ليس لك إغلاقُ هذا الطلب" };
  if (r.status === "done") return { ok: false, reason: "الطلب مُغلقٌ من قبل" };
  let note = String(rawNote ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

  if (r.type === "welcome_banner") {
    // **لا يُغلق قبل التنفيذ:** البنرُ هو بطاقةُ الانضمام تصل بريدَ صاحبها — يُتحقَّق منه لا يُفترض
    const settled = bannerSettled(r.linkedMember);
    if (!settled.ok) {
      return { ok: false, reason: "لم يصل البنرُ الترحيبيُّ صاحبَه بعد — أرسله من «الترحيب والتكريم»، ويُغلَق الطلبُ آلياً حين يصل" };
    }
    note = note || settled.why;
  } else if (r.type === "meeting") {
    if (note.length < 10) return { ok: false, reason: "اكتب نتيجة اجتماع الشرح (متى عُقد وما تقرّر) — لا يُغلَق الطلبُ بلا نتيجة" };
  } else if (note.length < 3) {
    return { ok: false, reason: "اكتب سبب الإغلاق" };
  }

  const at = new Date();
  const w = await prisma.request.updateMany({
    where: { id: requestId, status: OPEN },
    data: { status: "done", closedAt: at, closedById: actor.id, closedByName: actor.name, closeNote: note, closedAutomatically: false },
  });
  if (w.count === 0) return { ok: false, reason: "أُغلق الطلبُ للتوّ — حدّث الصفحة" };
  await logClosure(r, { by: actor.name, note, at, automatic: false });
  return { ok: true };
}

/** **الإغلاقُ الآلي** — حين يقع ما طُلب فعلاً (أو تنتهي الحاجة إليه). لا يمسّ المُغلق */
export async function autoCloseRequests(opts: { memberId: string; type: RequestType; note: string; at?: Date }): Promise<number> {
  const at = opts.at ?? new Date();
  const open = await prisma.request.findMany({
    where: { linkedMemberId: opts.memberId, type: opts.type, status: OPEN },
    include: { targetDepartment: { select: { name: true } }, linkedMember: { select: { fullName: true, email: true } } },
  });
  let closed = 0;
  for (const r of open) {
    const w = await prisma.request.updateMany({
      where: { id: r.id, status: OPEN },
      data: { status: "done", closedAt: at, closedById: null, closedByName: AUTO_CLOSER, closeNote: opts.note, closedAutomatically: true },
    });
    if (w.count) {
      closed += 1;
      await logClosure(r, { by: AUTO_CLOSER, note: opts.note, at, automatic: true });
    }
  }
  return closed;
}

/** هل لهذا الشخص طلبٌ مفتوحٌ من هذا النوع؟ — فلا يُنشأ طلبٌ مكرَّر للمناسبة نفسها */
export async function hasOpenRequest(memberId: string, type: RequestType): Promise<boolean> {
  return (await prisma.request.count({ where: { linkedMemberId: memberId, type, status: OPEN } })) > 0;
}

/** **الكنسُ اليومي:** طلبٌ انتهت مناسبتُه بمسارٍ لم ينادِ الإغلاقَ يُغلَق هنا —
 *  اجتماعُ شرحٍ لمرشّحٍ بُتّ في أمره، وبنرٌ وصل أو غادر صاحبُه. */
export async function sweepSettledRequests(): Promise<number> {
  let closed = 0;
  const meetings = await prisma.request.findMany({
    where: { type: "meeting", status: OPEN, linkedMemberId: { not: null } },
    select: {
      linkedMemberId: true,
      linkedMember: { select: { approvalStatus: true, testStatus: true, isActive: true, terminatedAt: true } },
    },
    take: 500,
  });
  for (const r of meetings) {
    const m = r.linkedMember;
    const why = !m
      ? "صاحبُه لم يعد في المنصة"
      : m.approvalStatus === "rejected"
        ? "رُفض المرشّح — انتهت الحاجة إلى الاجتماع"
        : m.approvalStatus === "approved"
          ? "اعتُمد المرشّح — انتهت الحاجة إلى الاجتماع"
          : !m.isActive || m.terminatedAt
            ? "غادر المرشّح — انتهت الحاجة إلى الاجتماع"
            : m.testStatus === "not_started"
              ? "أُعيد فتحُ اختبار المرشّح بعد اجتماع الشرح"
              : null;
    if (why) closed += await autoCloseRequests({ memberId: r.linkedMemberId!, type: "meeting", note: why });
  }
  const banners = await prisma.request.findMany({
    where: { type: "welcome_banner", status: OPEN, linkedMemberId: { not: null } },
    select: {
      linkedMemberId: true,
      linkedMember: { select: { welcomeEmailSentAt: true, isActive: true, terminatedAt: true, noFurtherEmail: true } },
    },
    take: 500,
  });
  for (const r of banners) {
    const s = bannerSettled(r.linkedMember);
    if (s.ok) closed += await autoCloseRequests({ memberId: r.linkedMemberId!, type: "welcome_banner", note: s.why });
  }
  return closed;
}

async function logClosure(
  r: { type: RequestType; targetDepartment: { name: string }; linkedMember: { fullName: string; email: string } | null },
  c: { by: string; note: string; at: Date; automatic: boolean }
) {
  await appendMemberEvent({
    fullName: r.linkedMember?.fullName ?? c.by,
    email: r.linkedMember?.email ?? "",
    roleOrDepartment: r.targetDepartment.name,
    event: c.automatic ? "إغلاق طلب آلياً" : "إغلاق طلب",
    details: `${r.type} — ${c.note} — ${c.automatic ? "آلياً" : `أغلقه ${c.by}`}`,
    at: c.at,
  });
}
