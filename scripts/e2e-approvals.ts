import { prisma } from "@/lib/prisma";
import {
  requestApproval, decideApproval, canDecideApproval, resubmitApproval,
  advanceExecution, approvalsAwaiting, myApprovalRequests, possibleApprovers,
  APPROVAL_STATE_LABELS,
} from "@/lib/approvals";
import { raiseTicket } from "@/lib/tickets";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}
const STAMP = Date.now();
const sess = (id: string) => ({ user: { id } });

/** الاعتمادات الإدارية — والمثال العملي الذي طلبه المؤسس:
 *  قائد التسويق يرفع خطة ← التنفيذي يعتمدها ← يبدأ التنفيذ.
 *  ثم: التنفيذي يرفع إلى المؤسس. ثم: من لا يملك الاعتماد يُرفَض. */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التسويق" } });

  const lead = await prisma.user.create({
    data: { fullName: `قائد تسويق ${STAMP}`, email: `apr-lead-${STAMP}@example.test`,
            passwordHash: "x", role: "department_admin", departmentId: dept.id,
            jobTitle: "قائد التسويق", isActive: true },
  });
  const other = await prisma.user.create({
    data: { fullName: `قائد آخر ${STAMP}`, email: `apr-other-${STAMP}@example.test`,
            passwordHash: "x", role: "department_admin", isActive: true },
  });

  const mkTicket = async (subject: string, by = lead.id) =>
    raiseTicket({ raisedByUserId: by, targetDepartmentId: dept.id, subject, description: "خطة" });

  // ── ١) التذكرة العادية بلا اعتماد — والاختيارية مقصودة
  const plain = await mkTicket("تذكرة عادية");
  chk("التذكرة العادية بلا طلب اعتماد", plain.approvalState === null);
  chk("ولا تُعتمَد لأنها بلا طلب",
      canDecideApproval({ approvalState: null, approverUserId: null, raisedByUserId: lead.id },
                        sess(exec.id)) === false);

  // ── ٢) قائد التسويق يرفع خطةً تحتاج اعتماد التنفيذي
  const t1 = await mkTicket("الخطة التسويقية للربع");
  const self = await requestApproval({
    ticketId: t1.id, requesterUserId: lead.id, kind: "marketing_plan", approverUserId: lead.id });
  chk("**لا يُرسل أحدٌ طلبه إلى نفسه**", self.ok === false,
      self.ok === false ? self.reason : "مرّ!");

  const req = await requestApproval({
    ticketId: t1.id, requesterUserId: lead.id, kind: "marketing_plan", approverUserId: exec.id });
  chk("الطلب يُرفَع إلى التنفيذي", req.ok, req.ok ? "" : (req as {reason:string}).reason);
  const afterReq = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
  chk("وحالتُه «بانتظار الاعتماد»", afterReq.approvalState === "awaiting",
      APPROVAL_STATE_LABELS[afterReq.approvalState!]);

  const twice = await requestApproval({
    ticketId: t1.id, requesterUserId: lead.id, kind: "financial_plan", approverUserId: founder.id });
  chk("ولا يُعلَّق طلبٌ ثانٍ على التذكرة نفسها", twice.ok === false);

  // ── ٣) من لا يملك الاعتماد لا يعتمد — ولو نادى الإجراء من طرفه
  const fresh = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
  chk("**ولا يعتمد من ليس هو المعتمِد — ولو كان قائداً**",
      canDecideApproval(fresh, sess(other.id)) === false);
  chk("**ولا المؤسس لمجرّد أنه المؤسس — الصفة لا تُدخِل أحداً**",
      canDecideApproval(fresh, sess(founder.id)) === false);
  chk("ولا صاحبُ الطلب", canDecideApproval(fresh, sess(lead.id)) === false);
  chk("والمعتمِد المُسنَد إليه يملكه", canDecideApproval(fresh, sess(exec.id)) === true);

  const byOther = await decideApproval({
    ticketId: t1.id, actorUserId: other.id, actorName: "قائد آخر", decision: "approved" });
  chk("**والخادم يرفض قرار غير المخوَّل لا الواجهة**", byOther.ok === false,
      byOther.ok === false ? byOther.reason : "مرّ!");
  const stillAwaiting = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
  chk("ولم تتغيّر الحالة", stillAwaiting.approvalState === "awaiting");
  chk("ولم يُسجَّل قرار",
      (await prisma.approvalDecision.count({ where: { ticketId: t1.id } })) === 0);

  const bySelf = await decideApproval({
    ticketId: t1.id, actorUserId: lead.id, actorName: "القائد", decision: "approved" });
  chk("**ولا يعتمد صاحبُ الطلب طلبَه**", bySelf.ok === false,
      bySelf.ok === false ? bySelf.reason : "مرّ!");

  // ── ٤) «قيد المراجعة» إجراءٌ صريح لا أثرُ فتح
  const reviewing = await decideApproval({
    ticketId: t1.id, actorUserId: exec.id, actorName: exec.fullName, decision: "reviewing" });
  chk("«قيد المراجعة» إجراءٌ صريح", reviewing.ok && reviewing.state === "reviewing");

  // ── ٥) الردّ للتعديل يحتاج ملاحظة
  const noNote = await decideApproval({
    ticketId: t1.id, actorUserId: exec.id, actorName: exec.fullName, decision: "returned" });
  chk("الردّ للتعديل بلا ملاحظة مرفوض", noNote.ok === false,
      noNote.ok === false ? noNote.reason : "مرّ!");

  const returned = await decideApproval({
    ticketId: t1.id, actorUserId: exec.id, actorName: exec.fullName,
    decision: "returned", note: "أضف أرقام الميزانية والجدول الزمني" });
  chk("والردّ بملاحظةٍ يمرّ", returned.ok && returned.state === "returned");
  const afterReturn = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
  chk("وعدّاد الردّ سُجِّل", afterReturn.returnCount === 1, String(afterReturn.returnCount));

  // ── ٦) صاحبُ الطلب يُعيده بعد التعديل، ويعود للمعتمِد نفسه
  const notMine = await resubmitApproval({ ticketId: t1.id, requesterUserId: other.id });
  chk("ولا يُعيد الطلبَ غيرُ صاحبه", notMine.ok === false);
  const resub = await resubmitApproval({ ticketId: t1.id, requesterUserId: lead.id });
  chk("وصاحبُه يُعيده", resub.ok);
  const afterResub = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
  chk("فيعود «بانتظار الاعتماد» للمعتمِد نفسه",
      afterResub.approvalState === "awaiting" && afterResub.approverUserId === exec.id);

  // ── ٧) الاعتماد: والنقرة المزدوجة لا تُسجّل قرارين
  const ok1 = await decideApproval({
    ticketId: t1.id, actorUserId: exec.id, actorName: exec.fullName,
    decision: "approved", note: "معتمد" });
  chk("التنفيذي يعتمد", ok1.ok && ok1.state === "approved");
  const ok2 = await decideApproval({
    ticketId: t1.id, actorUserId: exec.id, actorName: exec.fullName, decision: "approved" });
  chk("**والاعتماد المكرّر لا يمرّ — الحرس في `where`**", ok2.ok === false,
      ok2.ok === false ? ok2.reason : "مرّ مرّتين!");

  const approved = await prisma.ticket.findUniqueOrThrow({ where: { id: t1.id } });
  chk("وخَتمُ الاعتماد مسجَّل", !!approved.approvedAt);
  chk("والمعتمِد منسوبٌ باسمه", approved.approvedByUserId === exec.id);
  const decisions = await prisma.approvalDecision.findMany({
    where: { ticketId: t1.id }, orderBy: { decidedAt: "asc" } });
  chk("**وسجلّ التدقيق يحفظ القرارات كلّها لا آخرَها**",
      decisions.length === 4,
      `${decisions.length} أحداث: ${decisions.map((d) => d.decision).join(" ← ")}`);
  chk("ونصُّ الملاحظة محفوظ",
      decisions.some((d) => (d.note ?? "").includes("الميزانية")));

  // ── ٨) التنفيذ لا يُمنَح قبل الاعتماد، ولصاحب الطلب
  const t2 = await mkTicket("خطة لم تُعتمد");
  await requestApproval({ ticketId: t2.id, requesterUserId: lead.id,
    kind: "financial_plan", approverUserId: exec.id });
  const earlyExec = await advanceExecution({
    ticketId: t2.id, requesterUserId: lead.id, to: "executing" });
  chk("**ولا يبدأ التنفيذ قبل الاعتماد**", earlyExec.ok === false,
      earlyExec.ok === false ? earlyExec.reason : "بدأ!");

  const notOwner = await advanceExecution({
    ticketId: t1.id, requesterUserId: other.id, to: "executing" });
  chk("ولا ينفّذ غيرُ صاحب الطلب", notOwner.ok === false);
  const started = await advanceExecution({
    ticketId: t1.id, requesterUserId: lead.id, to: "executing" });
  chk("وصاحبُه يبدأ التنفيذ بعد الاعتماد", started.ok);
  const done = await advanceExecution({
    ticketId: t1.id, requesterUserId: lead.id, to: "completed" });
  chk("ثم يُعلن الإكمال", done.ok);

  // ── ٩) المسار المتسلسل: قائد ← تنفيذي ← مؤسس
  const t3 = await mkTicket("مبادرة تحتاج موافقتين");
  await requestApproval({
    ticketId: t3.id, requesterUserId: lead.id, kind: "initiative",
    approverUserId: exec.id, chain: [founder.id] });
  const step1 = await decideApproval({
    ticketId: t3.id, actorUserId: exec.id, actorName: exec.fullName, decision: "approved" });
  chk("**الموافقة الأولى لا تَختِم الطلب**",
      step1.ok && step1.state === "awaiting" && step1.nextApproverName === founder.fullName,
      step1.ok ? `انتقل إلى ${step1.nextApproverName}` : "");
  const mid = await ticketRow(t3.id);
  chk("ولا يُكتب ختمُ الاعتماد النهائي بعد", mid.approvedAt === null);
  chk("والمعتمِد المنتظَر صار المؤسس", mid.approverUserId === founder.id);
  chk("والمرحلة تقدّمت", mid.approvalStep === 2, String(mid.approvalStep));

  const execAgain = await decideApproval({
    ticketId: t3.id, actorUserId: exec.id, actorName: exec.fullName, decision: "approved" });
  chk("ولا يعتمد من مرّت مرحلتُه", execAgain.ok === false);

  const step2 = await decideApproval({
    ticketId: t3.id, actorUserId: founder.id, actorName: founder.fullName, decision: "approved" });
  chk("**والموافقة الأخيرة تَختِمه معتمداً نهائياً**",
      step2.ok && step2.state === "approved");
  const sealed = await ticketRow(t3.id);
  chk("وخَتمُه مكتوب", !!sealed.approvedAt && sealed.approvedByUserId === founder.id);

  // ── ١٠) القوائم
  const t4 = await mkTicket("طلبٌ ينتظر المؤسس");
  await requestApproval({ ticketId: t4.id, requesterUserId: lead.id,
    kind: "resources", approverUserId: founder.id });
  const awaitingFounder = await approvalsAwaiting(founder.id);
  chk("«بانتظار اعتمادي» تُظهر ما يقف على طاولته",
      awaitingFounder.some((t) => t.id === t4.id));
  chk("ولا تُظهر ما اكتمل", awaitingFounder.every((t) => t.id !== t3.id));
  const mine = await myApprovalRequests(lead.id);
  chk("و«طلباتي» تُظهر طلباته", mine.length >= 4, String(mine.length));
  const approvers = await possibleApprovers(lead.id);
  chk("وقائمة المعتمِدين لا تحمل صاحبَ الطلب",
      approvers.every((a) => a.id !== lead.id));

  // تنظيف
  await prisma.ticket.deleteMany({
    where: { id: { in: [plain.id, t1.id, t2.id, t3.id, t4.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [lead.id, other.id] } } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();

async function ticketRow(id: string) {
  return prisma.ticket.findUniqueOrThrow({ where: { id } });
}
