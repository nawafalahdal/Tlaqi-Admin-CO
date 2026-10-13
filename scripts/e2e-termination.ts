import { prisma } from "@/lib/prisma";
import {
  submitTerminationRequest, decideTerminationRequest,
  withdrawTerminationRequest, sweepEffectiveTerminations, canDecide, openRequestFor,
} from "@/lib/termination";
import type { Session } from "next-auth";

/** «طلب إنهاء فترة الإدارة» — على عضوٍ اختباريٍّ يُنشأ ويُحذف. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") =>
  checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const EMAIL = `e2e-term-${Date.now()}@example.test`;
async function cleanup() {
  const m = await prisma.member.findUnique({ where: { email: EMAIL } });
  if (m) {
    await prisma.terminationRequest.deleteMany({ where: { memberId: m.id } });
    await prisma.member.delete({ where: { id: m.id } });
    await prisma.invite.deleteMany({ where: { email: EMAIL } });
  }
}

function sess(role: string, id: string, departmentId: string | null): Session {
  return { user: { id, role, departmentId, name: "مسؤول", email: "x@example.test" },
           expires: new Date(Date.now() + 3600_000).toISOString() } as unknown as Session;
}

(async () => {
  await cleanup();
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التقنية" } });
  const otherDept = await prisma.department.findFirstOrThrow({ where: { name: "التسويق" } });
  const track = await prisma.testTrack.findFirstOrThrow({ where: { departmentId: dept.id } });
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });

  const invite = await prisma.invite.create({
    data: { fullName: "عضو اختبار الإنهاء", email: EMAIL, targetRole: "member",
            departmentId: dept.id, testTrackId: track.id, invitedById: founder.id, status: "used" },
  });
  const member = await prisma.member.create({
    data: { fullName: "عضو اختبار الإنهاء", email: EMAIL, departmentId: dept.id,
            inviteId: invite.id, jobTitle: "مطوّر واجهات", approvalStatus: "approved",
            isActive: true, decidedAt: new Date("2026-01-01") },
  });

  // ١ — سببٌ قصير مرفوض
  const bad = await submitTerminationRequest({ memberId: member.id, reason: "خلاص", requestedEndDate: null });
  chk("سببٌ قصير مرفوض", bad.ok === false, bad.ok === false ? bad.reason : "قُبل!");

  // ٢ — الرفع
  const endDate = new Date(Date.now() + 7 * 86400_000);
  const r1 = await submitTerminationRequest({
    memberId: member.id, reason: "ارتباطات دراسية تمنعني من الاستمرار بالجهد المطلوب",
    requestedEndDate: endDate,
  });
  chk("رُفع الطلب", r1.ok);

  // ٣ — **الرفع لا يُعطّل**
  const afterSubmit = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("الرفع لا يُعطّل الحساب", afterSubmit.isActive === true);
  chk("ولا يُسجّل تنحية", afterSubmit.stepDownAt === null);
  chk("ولا يُنهي عضويته", afterSubmit.terminatedAt === null);

  // ٤ — لا طلب ثانٍ
  const dup = await submitTerminationRequest({ memberId: member.id, reason: "سببٌ آخر طويل كفاية", requestedEndDate: null });
  chk("لا طلب ثانٍ لمن له طلبٌ حيّ", dup.ok === false, dup.ok === false ? dup.reason : "قُبل!");

  const reqId = (r1 as { ok: true; id: string }).id;

  // ٥ — الصلاحية: قائد قسمٍ آخر لا يقرّر
  const lead2 = await prisma.user.findFirst({ where: { role: "department_admin", departmentId: otherDept.id } });
  if (lead2) {
    chk("قائد قسمٍ آخر لا يقرّر",
        (await canDecide({ memberId: member.id }, sess("department_admin", lead2.id, otherDept.id))) === false);
  }
  const lead1 = await prisma.user.findFirst({ where: { role: "department_admin", departmentId: dept.id } });
  if (lead1) {
    chk("قائد قسمه يقرّر",
        (await canDecide({ memberId: member.id }, sess("department_admin", lead1.id, dept.id))) === true);
  }
  chk("والفاوندر يقرّر", (await canDecide({ memberId: member.id }, sess("super_admin", founder.id, null))) === true);

  // ٦ — **طلب اللقاء ليس قراراً**
  const m1 = await decideTerminationRequest({ requestId: reqId, decision: "request_meeting",
    note: "نلتقي الأحد لنتحدث", actorId: founder.id, actorName: founder.fullName });
  chk("طُلب اللقاء", m1.ok);
  const afterMeeting = await prisma.terminationRequest.findUniqueOrThrow({ where: { id: reqId } });
  chk("الحالة «طُلب لقاء» لا موافقة ولا رفض", afterMeeting.status === "meeting_requested");
  chk("ولا تاريخ قرار", afterMeeting.decidedAt === null);
  chk("والطلب ما يزال حيّاً", (await openRequestFor(member.id)) !== null);
  const stillActive = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("وصاحبه ما يزال على عمله", stillActive.isActive === true && stillActive.stepDownAt === null);

  // ٧ — الرفض يحتاج تفسيراً
  const noNote = await decideTerminationRequest({ requestId: reqId, decision: "reject",
    actorId: founder.id, actorName: founder.fullName });
  chk("الرفض بلا تفسير مرفوض", noNote.ok === false, noNote.ok === false ? noNote.reason : "مرّ!");

  // ٨ — الموافقة
  const a1 = await decideTerminationRequest({ requestId: reqId, decision: "approve",
    note: "شكراً لجهدك", endDate, actorId: founder.id, actorName: founder.fullName });
  chk("وُوفق على الطلب", a1.ok && a1.status === "approved");

  // ٩ — **الموافقة وحدها لا تُنهي**
  const afterApprove = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("الموافقة وحدها لا تُنهي قبل التاريخ", afterApprove.isActive === true && afterApprove.stepDownAt === null);
  const swept0 = await sweepEffectiveTerminations();
  chk("والكنس لا يُنفّذ قبل حلول التاريخ", swept0 === 0, String(swept0));

  // ١٠ — قرارٌ ثانٍ لا يمرّ
  const dup2 = await decideTerminationRequest({ requestId: reqId, decision: "reject",
    note: "تغيير رأي", actorId: founder.id, actorName: founder.fullName });
  chk("قرارٌ ثانٍ على طلبٍ محسوم لا يمرّ", dup2.ok === false, dup2.ok === false ? dup2.reason : "مرّ!");
  const m2 = await decideTerminationRequest({ requestId: reqId, decision: "request_meeting",
    actorId: founder.id, actorName: founder.fullName });
  chk("ولا يُطلب لقاءٌ بعد الحسم", m2.ok === false, m2.ok === false ? m2.reason : "مرّ!");

  // ١١ — حلول التاريخ ثم الكنس يُنفّذ
  await prisma.terminationRequest.update({
    where: { id: reqId }, data: { requestedEndDate: new Date(Date.now() - 86400_000) },
  });
  const swept = await sweepEffectiveTerminations();
  chk("الكنس نفّذ الخروج بعد حلول التاريخ", swept === 1, String(swept));
  const done = await prisma.terminationRequest.findUniqueOrThrow({ where: { id: reqId } });
  chk("الحالة صارت «نُفِّذ»", done.status === "effective");
  chk("وتاريخ التنفيذ مُسجَّل", done.effectiveAt !== null);
  const closed = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  chk("سُجِّلت تنحيته", closed.stepDownAt !== null);
  chk("وتوقّف عمله", closed.isActive === false);
  chk("وتاريخ انتهائه مُثبَت", closed.endDate !== null);

  // ١٢ — كنسٌ ثانٍ لا يُكرّر
  const swept2 = await sweepEffectiveTerminations();
  chk("كنسٌ ثانٍ لا يُنفّذ مرّتين", swept2 === 0, String(swept2));

  // ١٣ — السحب قبل القرار
  await prisma.member.update({ where: { id: member.id },
    data: { isActive: true, stepDownAt: null, terminatedAt: null, endDate: null, exitReason: null } });
  const r2 = await submitTerminationRequest({ memberId: member.id,
    reason: "سببٌ ثانٍ مكتوبٌ بما يكفي من الأحرف", requestedEndDate: null });
  chk("طلبٌ جديد بعد تنفيذ الأول", r2.ok);
  if (r2.ok) {
    const wrongOwner = await withdrawTerminationRequest({ requestId: r2.id, memberId: founder.id });
    chk("لا يسحب الطلبَ غيرُ صاحبه", wrongOwner.ok === false);
    const w = await withdrawTerminationRequest({ requestId: r2.id, memberId: member.id });
    chk("صاحبه يسحبه", w.ok);
    chk("ولا يبقى طلبٌ حيّ", (await openRequestFor(member.id)) === null);
  }

  await cleanup();
  console.log(checks.join("\n"));
  const failed = checks.some((c) => c.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
