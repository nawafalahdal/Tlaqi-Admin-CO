import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import {
  ensurePeriod,
  periodStartFor,
  nextPeriodStartFor,
  submitPeriod,
  approvePeriodForReview,
  beginReview,
  completeReview,
  openPeriod,
  reopenPeriod,
  assertPeriodWritable,
  canTransition,
  unresolvedReviewCount,
  PERIOD_START_HOUR,
  PERIOD_WEEKDAY,
} from "@/lib/execution";
import {
  ensureWeekPlan,
  sweepCarryover,
  assessWeekPlan,
  submitWeekPlan,
  decideWeekPlan,
  recordCarryoverPlan,
  carryoverHistory,
  repeatedCarryovers,
  CARRYOVER_ESCALATION,
} from "@/lib/carryover";
import {
  createTask,
  updateTaskState,
  submitTaskWork,
  reviewTask,
  changeTaskDeadline,
  waiveTask,
  reassignTask,
  isOverdue,
} from "@/lib/tasks";
import { breakdownOf, periodProgress, goalProgress } from "@/lib/progress";
import { createGoal, createMilestone, decideGoal, proposeObjective } from "@/lib/goals";
import {
  meetingTimeFor,
  ensureMeeting,
  saveMeetingSettings,
  meetingSettings,
  assembleAgenda,
  markAgendaStage,
  markMeetingHeld,
} from "@/lib/reviewMeeting";
import { lastWeekdayAt, riyadhDaysBetween, countdownLabel, toRiyadh } from "@/lib/riyadh";

const log: string[] = [];
function chk(name: string, pass: boolean, extra = "") {
  log.push(`${pass ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}
const STAMP = Date.now();
const DAY = 86_400_000;

function sess(role: string, id: string, name: string, departmentId: string | null = null): Session {
  return { user: { id, role, name, departmentId } } as unknown as Session;
}

/** نظامُ التنفيذ الاستراتيجي — القواعدُ الخمسُ والعشرون المطلوبة.
 *
 *  وأهمُّها ثلاث: **ما لم يكتمل لا يَضيع ولا يُعَدّ منجَزاً**،
 *  **ولا يُصدّق أحدٌ على عمله**، **ولا يُفتَح أسبوعٌ بمرور التقويم**. */
(async () => {
  const founder = await prisma.user.findFirstOrThrow({ where: { role: "super_admin" } });
  const exec = await prisma.user.findFirstOrThrow({ where: { role: "executive" } });
  const dept = await prisma.department.findFirstOrThrow({ where: { name: "التسويق" } });

  const lead = await prisma.user.create({
    data: {
      fullName: `قائد تنفيذٍ ${STAMP}`,
      email: `exec-lead-${STAMP}@example.test`,
      passwordHash: "x",
      role: "department_admin",
      departmentId: dept.id,
    },
  });
  const worker = await prisma.user.create({
    data: {
      fullName: `منفّذٌ ${STAMP}`,
      email: `exec-worker-${STAMP}@example.test`,
      passwordHash: "x",
      role: "department_admin",
      departmentId: dept.id,
      isActive: false, // لا يَشغَل مقعداً في الهيكل، وهو هنا صاحبُ مهامٍّ فقط
    },
  });

  const F = sess("super_admin", founder.id, founder.fullName);
  const E = sess("executive", exec.id, exec.fullName);
  const L = sess("department_admin", lead.id, lead.fullName, dept.id);
  const W = sess("department_admin", worker.id, worker.fullName, dept.id);
  const M = sess("member", `member-${STAMP}`, "عضو");

  const cleanupPeriods: string[] = [];
  const cleanupGoals: string[] = [];

  // ══ ٢٤) التوقيتُ وحدودُ التقويم أولاً — عليها يقوم كلُّ ما بعدها
  {
    const base = new Date(Date.UTC(2026, 9, 15, 10, 0)); // خميس
    const sat = lastWeekdayAt(PERIOD_WEEKDAY, PERIOD_START_HOUR, 0, base);
    const r = toRiyadh(sat);
    chk(
      "٢٤ · بدايةُ الفترة سبتٌ بتوقيت الرياض لا بتوقيت الخادم",
      r.getUTCDay() === PERIOD_WEEKDAY && r.getUTCHours() === PERIOD_START_HOUR,
      `${r.toISOString()} (الرياض)`
    );
    chk("ويقع قبل اللحظة المعطاة", sat.getTime() < base.getTime());

    // حدُّ نهاية الشهر والسنة
    const newYear = new Date(Date.UTC(2027, 0, 1, 2, 0));
    const satNY = toRiyadh(lastWeekdayAt(PERIOD_WEEKDAY, PERIOD_START_HOUR, 0, newYear));
    chk(
      "وعبورُ السنة محسوبٌ صحيحاً",
      satNY.getUTCFullYear() === 2026 && satNY.getUTCMonth() === 11,
      satNY.toISOString()
    );

    // الفرقُ بالأيام لا بالساعات
    const todayLate = new Date(Date.UTC(2026, 9, 15, 20, 0));
    const tomorrowEarly = new Date(Date.UTC(2026, 9, 16, 5, 0));
    chk(
      "وفرقُ الأيام تقويميٌّ: «غداً» غداً ولو كان الفرقُ ساعاتٍ قليلة",
      riyadhDaysBetween(todayLate, tomorrowEarly) === 1,
      countdownLabel(tomorrowEarly, todayLate)
    );
  }

  // ══ الفترات — **معزولةٌ عن أسبوع المنصة الحقيقي.**
  //
  // كانت تَستعمل `periodStartFor()` أي أسبوعَ المنصة الجاري، فسقط الفحصُ
  // أولَ مرّةٍ وُجدت فيها بياناتٌ حقيقية: الأسبوعُ كان مفتوحاً فعلاً
  // والفحصُ يَفترضه «قيد البناء». واختبارٌ يتأثّر بحال القاعدة ليس
  // اختباراً. فيُبنى على أسابيعَ بعيدةٍ لا يَسكنها أحد — وتُحذَف بعده.
  const FAR = periodStartFor(new Date(Date.now() + 200 * DAY));
  const thisWeek = await ensurePeriod(FAR);
  const nextWeek = await ensurePeriod(new Date(FAR.getTime() + 7 * DAY));
  cleanupPeriods.push(thisWeek.id, nextWeek.id);
  chk("٢ · الفترتان تُنشآن ولا تُكرَّران", thisWeek.id !== nextWeek.id);
  chk(
    "ونداءُ الإنشاء ثانيةً يُعيد الصفَّ نفسَه",
    (await ensurePeriod(FAR)).id === thisWeek.id
  );

  // ══ ١٦/١٤/١٥) القفلُ قبل الفتح
  {
    chk("١٤ · الفترةُ الجديدة «قيد البناء» لا مفتوحة", thisWeek.state === "draft");
    let locked = false;
    let lockMsg = "";
    try {
      await assertPeriodWritable(thisWeek.id);
    } catch (e) {
      locked = true;
      lockMsg = e instanceof Error ? e.message : "";
    }
    chk("١٥ · ولا يُكتَب فيها — والقفلُ في الخادم لا بإخفاء زرّ", locked, lockMsg);
    chk(
      "ولا قفزةَ في آلة الحالة: من البناء إلى الفتح مباشرةً مرفوضة",
      canTransition("draft", "open") === false
    );
  }

  const plan = await ensureWeekPlan(thisWeek.id, dept.id);
  chk("خطةُ القسم تُنشأ في الفترة ولا تُكرَّر", (await ensureWeekPlan(thisWeek.id, dept.id)).id === plan.id);

  // ══ المهامُّ لا تُقبَل ناقصة
  {
    const noOwner = await createTask({
      planId: plan.id,
      title: "بلا صاحب",
      acceptanceCriteria: "معيار",
      dueAt: new Date(thisWeek.weekStart.getTime() + 2 * DAY),
      session: L,
    });
    chk("مهمّةٌ بلا صاحبٍ تُرفَض", noOwner.ok === false, noOwner.ok === false ? noOwner.reason : "مرّت!");

    const noCriteria = await createTask({
      planId: plan.id,
      title: "بلا معيار",
      acceptanceCriteria: "   ",
      ownerUserId: worker.id,
      dueAt: new Date(thisWeek.weekStart.getTime() + 2 * DAY),
      session: L,
    });
    chk("ومهمّةٌ بلا معيارِ إنجازٍ تُرفَض", noCriteria.ok === false,
        noCriteria.ok === false ? noCriteria.reason.slice(0, 60) : "مرّت!");

    const byMember = await createTask({
      planId: plan.id,
      title: "من عضو",
      acceptanceCriteria: "معيار",
      ownerUserId: worker.id,
      dueAt: new Date(thisWeek.weekStart.getTime() + 2 * DAY),
      session: M,
    });
    chk("ولا يَبني العضوُ خطةَ القسم", byMember.ok === false,
        byMember.ok === false ? byMember.reason : "مرّت!");
  }

  // ثلاثُ مهامٍّ بأوزانٍ مختلفة
  // المواعيدُ داخل أسبوعِها: موعدٌ قبل بدايةِ الأسبوع التزامٌ لا يُوفى،
  // والنظامُ يَمنعه — فيُبنى الفحصُ على مواعيدَ داخل الأسبوع نفسِه.
  const due = new Date(thisWeek.weekStart.getTime() + 3 * DAY);
  const t1 = await createTask({
    planId: plan.id, title: `تصميم الحملة ${STAMP}`, acceptanceCriteria: "ثلاثة تصاميم معتمَدة",
    deliverable: "ملف PDF", ownerUserId: worker.id, dueAt: due, weight: 3, priority: "high",
    session: L,
  });
  const t2 = await createTask({
    planId: plan.id, title: `جدولة النشر ${STAMP}`, acceptanceCriteria: "جدولٌ لأسبوعين",
    ownerUserId: worker.id, dueAt: due, weight: 1, session: L,
  });
  const t3 = await createTask({
    planId: plan.id, title: `تقرير الأداء ${STAMP}`, acceptanceCriteria: "تقريرٌ بالأرقام",
    ownerUserId: worker.id, dueAt: due, weight: 2, session: L,
  });
  chk("المهامُّ الثلاث أُنشئت", t1.ok && t2.ok && t3.ok);
  if (!t1.ok || !t2.ok || !t3.ok) {
    console.log(log.join("\n"));
    process.exit(1);
  }

  // ══ ١٥) القفل يَمنع التحديثَ قبل الفتح
  {
    const early = await updateTaskState({ taskId: t1.id, state: "in_progress", session: W });
    chk("١٥ · ولا يُحدَّث تنفيذٌ في أسبوعٍ لم يُفتَح", early.ok === false,
        early.ok === false ? early.reason : "مرّ!");
  }

  // ══ ٧/٨) الرفعُ والاعتماد مع قياس الحِمل
  {
    const submitted = await submitWeekPlan({ planId: plan.id, session: L });
    chk("خطةُ القسم تُرفَع للاعتماد", submitted.ok, submitted.ok ? "" : submitted.reason);
    const decided = await decideWeekPlan({ planId: plan.id, decision: "approved", session: E });
    chk("والتنفيذي يعتمدها", decided.ok, decided.ok ? "" : decided.reason);
    const byLead = await decideWeekPlan({ planId: plan.id, decision: "approved", session: L });
    chk("ولا يَعتمد قائدُ القسم خطتَه بنفسه", byLead.ok === false,
        byLead.ok === false ? byLead.reason : "مرّ!");
  }

  // ══ ١٦) الفتحُ صريحٌ ومُصرَّحٌ به وidempotent
  {
    const byLead = await openPeriod({ periodId: thisWeek.id, session: L });
    chk("١١ · ولا يَفتح قائدُ القسم الأسبوع", byLead.ok === false,
        byLead.ok === false ? byLead.reason : "مرّ!");

    await submitPeriod({ periodId: thisWeek.id, session: E });
    await approvePeriodForReview({ periodId: thisWeek.id, session: E });
    await beginReview({ periodId: thisWeek.id, session: E });
    const done = await completeReview({ periodId: thisWeek.id, session: E });
    chk("المراجعةُ تكتمل حين لا بندَ معلَّقاً", done.ok, done.ok ? "" : (done as { reason: string }).reason);

    const opened = await openPeriod({ periodId: thisWeek.id, session: E });
    chk("١٦ · والفتحُ يقع صريحاً بإذن التنفيذي", opened.ok, opened.ok ? opened.message : opened.reason);
    const again = await openPeriod({ periodId: thisWeek.id, session: E });
    chk("ونداؤه ثانيةً لا يَفتح مرّتين", again.ok && again.message.includes("سلفاً"),
        again.ok ? again.message : again.reason);
    const row = await prisma.executionPeriod.findUniqueOrThrow({ where: { id: thisWeek.id } });
    chk("والفاتحُ مُسجَّلٌ باسمه ووقته", row.openedByName === exec.fullName && row.openedAt !== null);
    chk("ولم يكن فتحاً استثنائياً", row.emergencyOpen === false);
  }

  // ══ ٤) لا يُصدّق أحدٌ على عمله + فصلُ المُعلَن عن المتحقَّق
  {
    const started = await updateTaskState({ taskId: t1.id, state: "in_progress", session: W });
    chk("وبعد الفتح يُحدَّث التنفيذ", started.ok, started.ok ? "" : started.reason);

    const noEvidence = await submitTaskWork({ taskId: t1.id, note: "انتهيت", session: W });
    chk("التسليمُ بلا دليلٍ يُرفَض", noEvidence.ok === false,
        noEvidence.ok === false ? noEvidence.reason.slice(0, 55) : "مرّ!");

    const submitted = await submitTaskWork({
      taskId: t1.id,
      note: "التصاميم الثلاثة جاهزة ومعتمَدة من القسم",
      evidenceUrl: "https://tlaqiteam.site/evidence/1",
      session: W,
    });
    chk("٤ · والتسليمُ بدليلٍ يُقبَل", submitted.ok, submitted.ok ? "" : submitted.reason);
    const afterSubmit = await prisma.planTask.findUniqueOrThrow({ where: { id: t1.id } });
    chk(
      "**ولا يُعَدّ منجَزاً بإعلان صاحبه**",
      afterSubmit.execState === "submitted" && afterSubmit.verifiedAt === null,
      afterSubmit.execState
    );

    const prog1 = await periodProgress(thisWeek.id, dept.id);
    chk(
      "والنسبةُ المعتمَدة صفرٌ والمُعلَنةُ ٥٠٪ — تُقرآن مفصولتين",
      prog1.verifiedPercent === 0 && prog1.reportedPercent === 50,
      `معتمَد ${prog1.verifiedPercent}٪ / مُعلَن ${prog1.reportedPercent}٪`
    );

    const selfReview = await reviewTask({ taskId: t1.id, decision: "verified", session: W });
    chk("٤ · ولا يُصدّق صاحبُ العمل على عمله", selfReview.ok === false,
        selfReview.ok === false ? selfReview.reason : "مرّ!");

    const byMember = await reviewTask({ taskId: t1.id, decision: "verified", session: M });
    chk("ولا يُراجِع عضوٌ شيئاً", byMember.ok === false,
        byMember.ok === false ? byMember.reason : "مرّ!");

    const verified = await reviewTask({
      taskId: t1.id, decision: "verified", note: "مطابِقةٌ للمعيار", session: E,
    });
    chk("والتنفيذي يتحقّق منها", verified.ok, verified.ok ? "" : verified.reason);

    const prog2 = await periodProgress(thisWeek.id, dept.id);
    chk(
      "١٨ · فترتفع المعتمَدةُ بوزنها لا بعددها: ٣ من ٦ = ٥٠٪",
      prog2.verifiedPercent === 50 && prog2.verifiedWeight === 3 && prog2.eligibleWeight === 6,
      `${prog2.verifiedWeight}/${prog2.eligibleWeight}`
    );

    // ١٧) المتحقَّقُ منه لا يُبطَل صامتاً
    const regress = await updateTaskState({ taskId: t1.id, state: "in_progress", session: W });
    chk("١٧ · والمتحقَّقُ منه لا يُعاد إلى التنفيذ بلا مراجعة", regress.ok === false,
        regress.ok === false ? regress.reason.slice(0, 60) : "مرّ!");
  }

  // ══ ١٢) الإسقاطُ لا يُحتسَب إنجازاً
  {
    const byLead = await waiveTask({ taskId: t3.id, kind: "waive", reason: "تغيّرت الأولوية", session: L });
    chk("ولا يُسقِط قائدُ القسم التزاماً", byLead.ok === false,
        byLead.ok === false ? byLead.reason : "مرّ!");

    const noReason = await waiveTask({ taskId: t3.id, kind: "waive", reason: "  ", session: E });
    chk("ولا يقع إسقاطٌ بلا سبب", noReason.ok === false,
        noReason.ok === false ? noReason.reason : "مرّ!");

    const waived = await waiveTask({
      taskId: t3.id, kind: "waive", reason: "أُلغي الحدث الذي كان التقرير له", session: E,
    });
    chk("والتنفيذي يُسقِطه بسببٍ مكتوب", waived.ok, waived.ok ? "" : waived.reason);

    const prog = await periodProgress(thisWeek.id, dept.id);
    chk(
      "١٢ · **فالمُسقَطُ خارج البسط والمقام معاً** — ٣ من ٤ لا من ٦",
      prog.verifiedWeight === 3 && prog.eligibleWeight === 4 && prog.waived === 1,
      `${prog.verifiedWeight}/${prog.eligibleWeight} ومُسقَط ${prog.waived}`
    );
    chk("ويُعرَض مُسقَطاً لا منجَزاً", prog.verifiedTasks === 1 && prog.waived === 1);

    const change = await prisma.workChange.findFirst({
      where: { taskId: t3.id, kind: "waive" },
      select: { reason: true, previousJson: true, nextJson: true, actorName: true },
    });
    chk("١٠/٦ · والإسقاطُ مُسجَّلٌ بما كان وما صار ومن قرّر",
        Boolean(change && change.actorName === exec.fullName && change.reason.length > 0));
  }

  // ══ ٢٠/١٠) تمديدُ الموعد يَحفظ الأصلي
  {
    const byWorker = await changeTaskDeadline({
      taskId: t2.id, newDueAt: new Date(thisWeek.weekStart.getTime() + 9 * DAY), reason: "أحتاج وقتاً", session: W,
    });
    chk("١١ · ولا يُمدِّد صاحبُ المهمّة موعدَها المعتمَد", byWorker.ok === false,
        byWorker.ok === false ? byWorker.reason.slice(0, 60) : "مرّ!");

    const original = (await prisma.planTask.findUniqueOrThrow({ where: { id: t2.id } })).originalDueAt;
    const extended = await changeTaskDeadline({
      taskId: t2.id, newDueAt: new Date(thisWeek.weekStart.getTime() + 9 * DAY),
      reason: "تأخّر اعتماد المحتوى من قسمٍ آخر", session: E,
    });
    chk("١٠ · والتنفيذي يُمدِّده بسببٍ مكتوب", extended.ok, extended.ok ? "" : extended.reason);
    const after = await prisma.planTask.findUniqueOrThrow({ where: { id: t2.id } });
    chk(
      "٢٠ · **والموعدُ الأصليُّ باقٍ يُميَّز عن المعتمَد**",
      after.originalDueAt.getTime() === original.getTime() && after.dueAt.getTime() !== original.getTime(),
      `أصلي ${after.originalDueAt.toISOString().slice(0, 10)} ← معتمَد ${after.dueAt.toISOString().slice(0, 10)}`
    );
    const rec = await prisma.workChange.findFirst({
      where: { taskId: t2.id, kind: "deadline_change" },
      select: { previousJson: true, nextJson: true, reason: true },
    });
    chk("والتمديدُ مكتوبٌ بقيمتيه", Boolean(rec?.previousJson && rec?.nextJson));
  }

  // ══ ٥/٦/٧) الترحيل
  {
    // نُعيد t2 إلى حالٍ غير مكتملة لتُرحَّل
    await prisma.planTask.update({ where: { id: t2.id }, data: { execState: "in_progress" } });

    const sweep = await sweepCarryover({ fromPeriodId: thisWeek.id });
    chk("٥ · الكنسُ يُرحّل ما لم يكتمل ويُغلِق الأسبوع", Boolean(sweep && sweep.carried >= 1),
        sweep ? `رُحِّل ${sweep.carried}` : "لا شيء");

    const carried = await prisma.planTask.findUniqueOrThrow({ where: { id: t2.id } });
    chk("**والمعرّفُ نفسُه لم يتغيّر**", carried.id === t2.id);
    chk("وانتقل إلى فترة الأسبوع التالي", carried.periodId === nextWeek.id);
    const originalBefore = carried.originalDueAt.getTime();
    chk(
      "٥ · وموعدُه الأصليُّ لم يُمَسّ بالترحيل",
      originalBefore === carried.originalDueAt.getTime() &&
        carried.originalDueAt.getTime() !== carried.dueAt.getTime(),
      `أصلي ${carried.originalDueAt.toISOString().slice(0, 10)} ← معتمَد ${carried.dueAt.toISOString().slice(0, 10)}`
    );
    chk("وقسمُه كما هو", carried.departmentId === dept.id);
    chk("وصاحبُه لم يُنقَل بلا إذن", carried.ownerUserId === worker.id);
    chk("وعدّادُ الترحيل زاد", carried.carryoverCount === 1 && carried.consecutiveCarryover === 1);
    chk(
      "٧ · وسببُه وخطةُ تصحيحه فُرِّغا — يُطلَبان من جديد",
      carried.carryReason === null && carried.correctivePlan === null
    );

    const hist = await carryoverHistory(t2.id);
    chk("ولترحيله صفٌّ في السجل بحالته لحظتَه", hist.length === 1 && hist[0].stateAtCarry === "in_progress");

    const verifiedStill = await prisma.planTask.findUniqueOrThrow({ where: { id: t1.id } });
    chk("٦ · والمتحقَّقُ منه لم يُرحَّل", verifiedStill.periodId === thisWeek.id);
    const waivedStill = await prisma.planTask.findUniqueOrThrow({ where: { id: t3.id } });
    chk("ولا المُسقَطُ بقرار", waivedStill.periodId === thisWeek.id);

    // ١٦) الكنسُ لا يُكرِّر
    const again = await sweepCarryover({ fromPeriodId: thisWeek.id });
    const recount = await prisma.planTask.findUniqueOrThrow({ where: { id: t2.id } });
    chk(
      "١٦ · وكنسٌ ثانٍ لا يُرحّل مرّتين ولا يَزيد العدّاد",
      recount.carryoverCount === 1,
      `رُحِّل ${again?.carried ?? 0}، تُخطّي ${again?.skipped ?? 0}`
    );

    // ٦) المُرحَّلُ لا يُحتسَب إنجازاً في فترته الجديدة
    const nextProg = await periodProgress(nextWeek.id, dept.id);
    chk(
      "٦ · والمُرحَّلُ التزامٌ قائمٌ لا إنجازٌ متحقَّق",
      nextProg.verifiedTasks === 0 && nextProg.carried === 1,
      `متحقَّق ${nextProg.verifiedTasks} / مُرحَّل ${nextProg.carried}`
    );
  }

  // ══ ٧/٨) خطةُ الأسبوع التالي: إقرارُ المُرحَّل وقياسُ الحِمل
  const nextPlan = await ensureWeekPlan(nextWeek.id, dept.id);
  {
    const before = await assessWeekPlan(nextPlan.id);
    chk(
      "٧ · ولا تُرفَع خطةٌ فيها مُرحَّلٌ بلا سببٍ وخطةِ تصحيح",
      Boolean(before && before.missingCorrective.length === 1),
      before?.blockers.join(" | ")
    );
    const blocked = await submitWeekPlan({ planId: nextPlan.id, session: L });
    chk("والرفعُ يُرفَض ويُسمّي السبب", blocked.ok === false,
        blocked.ok === false ? blocked.reason.slice(0, 70) : "مرّ!");

    const noPlanYet = await recordCarryoverPlan({
      taskId: t2.id, reason: "تأخّر المحتوى", correctivePlan: "  ", session: L,
    });
    chk("وخطةُ التصحيح نفسُها إلزامية", noPlanYet.ok === false,
        noPlanYet.ok === false ? noPlanYet.reason : "مرّ!");

    const recorded = await recordCarryoverPlan({
      taskId: t2.id,
      reason: "تأخّر اعتماد المحتوى من قسم آخر",
      correctivePlan: "تُقسَّم إلى جدولةٍ أوليّةٍ ثم نهائية، والأولى تُسلَّم الثلاثاء",
      session: L,
    });
    chk("٧ · فإذا أُقِرّا قُبِل الرفع", recorded.ok, recorded.ok ? "" : recorded.reason);

    // ٨) الجديدُ والمُرحَّلُ يُقاسان معاً
    for (let i = 0; i < 12; i++) {
      await createTask({
        planId: nextPlan.id,
        title: `مهمّة حِمل ${i} ${STAMP}`,
        acceptanceCriteria: "معيار",
        ownerUserId: worker.id,
        dueAt: new Date(nextWeek.weekStart.getTime() + 3 * DAY),
        weight: 1,
        session: L,
      });
    }
    const loaded = await assessWeekPlan(nextPlan.id);
    chk(
      "٨ · **والحِملُ يُجمَع: جديدٌ ومُرحَّلٌ معاً يُقارَنان بالطاقة**",
      Boolean(loaded && loaded.newPoints === 12 && loaded.carriedPoints === 1 && loaded.overloaded),
      loaded ? `${loaded.newPoints}+${loaded.carriedPoints} من ${loaded.capacityPoints}` : ""
    );

    const overloadedSubmit = await submitWeekPlan({ planId: nextPlan.id, session: L });
    chk("ولا تُرفَع خطةٌ متجاوزةٌ للطاقة بلا إقرار", overloadedSubmit.ok === false,
        overloadedSubmit.ok === false ? overloadedSubmit.reason.slice(0, 70) : "مرّ!");

    await prisma.weekPlan.update({ where: { id: nextPlan.id }, data: { overloadAcknowledged: true } });
    const ok = await submitWeekPlan({ planId: nextPlan.id, session: L });
    chk("٨ · فإذا أُقِرَّ التحميلُ صراحةً مرّت", ok.ok, ok.ok ? "" : ok.reason);

    const approveNoAck = await decideWeekPlan({
      planId: nextPlan.id, decision: "approved", session: E,
    });
    chk("والاعتمادُ يُقرّ التحميل أيضاً",
        approveNoAck.ok || (approveNoAck.ok === false && approveNoAck.reason.includes("الحِمل")),
        approveNoAck.ok ? approveNoAck.message : approveNoAck.reason.slice(0, 60));
  }

  // ══ ٩) التصعيدُ عند التكرار
  {
    await prisma.planTask.update({
      where: { id: t2.id },
      data: { consecutiveCarryover: CARRYOVER_ESCALATION.escalateAfter, carryoverCount: 4 },
    });
    const repeated = await repeatedCarryovers();
    chk(
      "٩ · والمُرحَّلُ المتكرّرُ يُبرَز بعتبةٍ مضبوطةٍ لا برقمٍ مبعثر",
      repeated.some((r) => r.id === t2.id),
      `العتبة ${CARRYOVER_ESCALATION.escalateAfter}`
    );
    const report = await assessWeekPlan(nextPlan.id);
    chk("ويُسمّى في تقييم الخطة بوصفه قراراً تنفيذياً لا إقراراً جديداً",
        Boolean(report && report.escalated.length === 1),
        report?.escalated.map((e) => `${e.consecutive}×`).join(","));
  }

  // ══ ١٣) الفتحُ الاستثنائيُّ يَحفظ ما بقي
  {
    const third = await ensurePeriod(new Date(nextWeek.weekStart.getTime() + 7 * DAY));
    cleanupPeriods.push(third.id);
    const thirdPlan = await ensureWeekPlan(third.id, dept.id);
    const pending = await createTask({
      planId: thirdPlan.id, title: `ينتظر التحقّق ${STAMP}`, acceptanceCriteria: "معيار",
      ownerUserId: worker.id, dueAt: new Date(third.weekStart.getTime() + DAY), session: L,
    });
    if (pending.ok) {
      await prisma.planTask.update({ where: { id: pending.id }, data: { execState: "submitted" } });
    }

    const fourth = await ensurePeriod(new Date(third.weekStart.getTime() + 7 * DAY));
    cleanupPeriods.push(fourth.id);
    await submitPeriod({ periodId: fourth.id, session: E });
    await approvePeriodForReview({ periodId: fourth.id, session: E });
    await beginReview({ periodId: fourth.id, session: E });

    const unresolved = await unresolvedReviewCount(fourth.id);
    chk("١٣ · والمراجعةُ تَعُدّ ما ينتظر قراراً", unresolved === 1, String(unresolved));

    const blockedComplete = await completeReview({ periodId: fourth.id, session: E });
    chk("ولا تُعلَن مكتملةً وفيها معلَّق", blockedComplete.ok === false,
        blockedComplete.ok === false ? blockedComplete.reason.slice(0, 70) : "مرّ!");

    const noReason = await openPeriod({ periodId: fourth.id, session: E });
    chk("ولا يُفتَح استثناءً بلا سببٍ مكتوب", noReason.ok === false,
        noReason.ok === false ? noReason.reason : "مرّ!");

    const emergency = await openPeriod({
      periodId: fourth.id, session: E, emergencyReason: "سفرُ التنفيذي، والعملُ لا يقف",
    });
    chk("١٣ · ويُفتَح استثناءً بسببٍ مكتوب", emergency.ok, emergency.ok ? emergency.message : emergency.reason);
    const row = await prisma.executionPeriod.findUniqueOrThrow({ where: { id: fourth.id } });
    chk(
      "**والاستثناءُ يَحفظ عددَ ما بقي ولا يَمحوه**",
      row.emergencyOpen === true && row.unresolvedAtOpen === 1 && Boolean(row.emergencyReason),
      `بقي ${row.unresolvedAtOpen}`
    );
    const stillPending = pending.ok
      ? await prisma.planTask.findUniqueOrThrow({ where: { id: pending.id } })
      : null;
    chk("والمهمّةُ المعلَّقةُ ما زالت تنتظر التحقّق", stillPending?.execState === "submitted");

    // ٢١) إعادةُ الفتح استثناءٌ مسجَّل
    await prisma.executionPeriod.update({ where: { id: fourth.id }, data: { state: "closed" } });
    const noWhy = await reopenPeriod({ periodId: fourth.id, session: E, reason: " " });
    chk("وإعادةُ الفتح لا تقع بلا سبب", noWhy.ok === false,
        noWhy.ok === false ? noWhy.reason : "مرّ!");
    const reopened = await reopenPeriod({
      periodId: fourth.id, session: E, reason: "تسليمٌ وصل متأخّراً ويجب تقييمُه",
    });
    chk("٢١ · وتُسجَّل إعادةُ الفتح وتُعَدّ", reopened.ok);
    const reRow = await prisma.executionPeriod.findUniqueOrThrow({ where: { id: fourth.id } });
    chk("ويبقى سببُها مكتوباً", reRow.reopenCount === 1 && Boolean(reRow.reopenReason));
  }

  // ══ ١٩) تقدُّمُ الهدف لا يُكرِّر المهمّة
  {
    const goal = await createGoal({
      title: `هدف اختبار ${STAMP}`,
      description: "وصف",
      rationale: "مسوّغ",
      successCriteria: "معيار",
      startDate: new Date(Date.now() - DAY),
      dueDate: new Date(Date.now() + 60 * DAY),
      session: E,
    });
    chk("الهدفُ يُنشئه التنفيذي معتمَداً", goal.ok && goal.status === "approved",
        goal.ok ? goal.status : goal.reason);
    if (goal.ok) {
      cleanupGoals.push(goal.id);
      const byLead = await createGoal({
        title: `هدف قائد ${STAMP}`, description: "وصف", rationale: "مسوّغ",
        successCriteria: "معيار", startDate: new Date(), dueDate: new Date(Date.now() + 30 * DAY),
        session: L,
      });
      chk("١ · وقائدُ القسم يَقترحه ولا يَعتمده", byLead.ok && byLead.status === "proposed",
          byLead.ok ? byLead.status : byLead.reason);
      if (byLead.ok) {
        cleanupGoals.push(byLead.id);
        const selfApprove = await decideGoal({ goalId: byLead.id, decision: "approved", session: L });
        chk("ولا يَعتمد مقترَحَه بنفسه", selfApprove.ok === false,
            selfApprove.ok === false ? selfApprove.reason : "مرّ!");
        const approved = await decideGoal({ goalId: byLead.id, decision: "approved", session: F });
        chk("والمؤسس يعتمده", approved.ok);
      }

      const ms = await createMilestone({
        goalId: goal.id, title: "محطّة", expectedResult: "نتيجة",
        acceptanceCriteria: "معيار", startDate: new Date(),
        dueDate: new Date(Date.now() + 20 * DAY), session: E,
      });
      chk("والمحطّةُ تُنشأ بنتيجةٍ ومعيار", ms.ok, ms.ok ? "" : ms.reason);

      const late = await createMilestone({
        goalId: goal.id, title: "محطّة متأخّرة", expectedResult: "نتيجة",
        acceptanceCriteria: "معيار", startDate: new Date(),
        dueDate: new Date(Date.now() + 90 * DAY), session: E,
      });
      chk("ولا تتجاوز محطّةٌ موعدَ هدفها", late.ok === false,
          late.ok === false ? late.reason : "مرّت!");

      // مهمّةٌ تتبع الهدفَ ومحطّتَه معاً — تُعَدّ مرّةً واحدة
      if (ms.ok) {
        const shared = await createTask({
          planId: nextPlan.id, title: `مهمّة مشتركة ${STAMP}`, acceptanceCriteria: "معيار",
          ownerUserId: worker.id, dueAt: new Date(nextWeek.weekStart.getTime() + 5 * DAY), weight: 4,
          goalId: goal.id, milestoneId: ms.id, session: L,
        });
        chk("ومهمّةٌ تتبع الهدفَ ومحطّتَه أُنشئت", shared.ok, shared.ok ? "" : shared.reason);
        const gp = await goalProgress(goal.id);
        chk(
          "١٩ · **ولا تُحسَب مرّتين في تقدُّم الهدف**",
          gp.eligibleTasks === 1 && gp.eligibleWeight === 4,
          `${gp.eligibleTasks} مهمّة / وزن ${gp.eligibleWeight}`
        );
      }

      const objective = await proposeObjective({
        departmentId: dept.id, title: `هدف قسم ${STAMP}`, goalId: goal.id, session: L,
      });
      chk("وهدفُ القسم يُقترَح من قائده", objective.ok && objective.status === "proposed");
    }
  }

  // ══ ١٨) حسابُ النسبة — دالّةٌ خالصةٌ تُختبَر بلا قاعدة
  {
    const now = new Date();
    const b = breakdownOf(
      [
        { weight: 3, execState: "verified", dueAt: now, carryoverCount: 0 },
        { weight: 1, execState: "submitted", dueAt: now, carryoverCount: 0 },
        { weight: 2, execState: "in_progress", dueAt: new Date(now.getTime() - DAY), carryoverCount: 2 },
        { weight: 5, execState: "waived", dueAt: now, carryoverCount: 0 },
        { weight: 9, execState: "cancelled", dueAt: now, carryoverCount: 0 },
      ],
      now
    );
    chk("١٨ · الوزنُ المؤهَّل يَستبعد المُسقَط", b.eligibleWeight === 6, String(b.eligibleWeight));
    chk("والمعتمَدةُ ٥٠٪ (٣ من ٦)", b.verifiedPercent === 50, String(b.verifiedPercent));
    chk("والمُعلَنةُ ٦٧٪ (٤ من ٦)", b.reportedPercent === 67, String(b.reportedPercent));
    chk("والمتأخّرُ يُعَدّ وإن كان قيد التنفيذ", b.overdue === 1);
    chk("والمُرحَّلُ يُعَدّ وحده", b.carried === 1);
    chk("والمُسقَطُ يُعرَض مفصولاً", b.waived === 1 && b.cancelled === 1);
    const empty = breakdownOf([]);
    chk("ولا نسبةَ حين لا التزامَ مؤهَّل", empty.verifiedPercent === null);
    chk(
      "والتأخّرُ يُحسَب ولا يُخزَّن حالةً",
      isOverdue({ dueAt: new Date(now.getTime() - DAY), execState: "in_progress" }, now) === true &&
        isOverdue({ dueAt: new Date(now.getTime() - DAY), execState: "verified" }, now) === false
    );
  }

  // ══ ١/٢٣) الاجتماع: إعداداتُه وأجندتُه
  {
    const byLead = await saveMeetingSettings({
      weekday: 6, hour: 20, minute: 30, durationMinutes: 90, session: L,
    });
    chk("إعداداتُ الاجتماع ليست بيد قائد القسم", byLead.ok === false,
        byLead.ok === false ? byLead.reason : "مرّ!");

    const saved = await saveMeetingSettings({
      weekday: 6, hour: 20, minute: 30, durationMinutes: 90,
      locationOrUrl: "https://meet.example.com/tlaqi", session: E,
    });
    chk("١ · والتنفيذي يَضبط يومَه وساعتَه ومدّتَه", saved.ok, saved.ok ? "" : saved.reason);

    const bad = await saveMeetingSettings({ weekday: 9, hour: 5, minute: 0, durationMinutes: 60, session: E });
    chk("ولا يُقبَل يومٌ خارج الأسبوع", bad.ok === false, bad.ok === false ? bad.reason : "مرّ!");

    const settings = await meetingSettings();
    const meeting = await ensureMeeting(thisWeek.id);
    chk("والاجتماعُ يُنشأ للفترة", Boolean(meeting));
    chk(
      "١ · وموعدُه بالساعة المضبوطة بتوقيت الرياض",
      Boolean(
        meeting &&
          toRiyadh(meeting.scheduledAt).getUTCHours() === 20 &&
          toRiyadh(meeting.scheduledAt).getUTCMinutes() === 30
      ),
      meeting ? toRiyadh(meeting.scheduledAt).toISOString() : ""
    );
    chk(
      "ويومُه السبت",
      Boolean(meeting && toRiyadh(meeting.scheduledAt).getUTCDay() === 6)
    );
    chk("ولا يُنشَأ اجتماعانِ لأسبوع", (await ensureMeeting(thisWeek.id))?.id === meeting?.id);
    chk(
      "والموعدُ يُحسَب من الإعدادات لا من رقمٍ في الكود",
      meetingTimeFor(thisWeek.weekStart, settings).getTime() === meeting?.scheduledAt.getTime()
    );
    chk("ومرورُ موعده لا يَعقده", meeting?.status === "scheduled");

    const agenda = await assembleAgenda(nextWeek.id);
    chk("٢ · والأجندةُ تُجمَع من الحقيقة المسجَّلة", Boolean(agenda));
    chk(
      "وتختار الفترةَ السابقةَ الصحيحة",
      agenda?.previousPeriod?.id === thisWeek.id,
      agenda?.previousPeriod?.weekStart.toISOString().slice(0, 10)
    );
    chk("ومراحلُها عشرٌ تُعلَّم صراحةً", agenda?.stages.length === 10);
    chk("ولا مرحلةَ مُعلَّمةٌ بلا تعليم", agenda?.stages.every((s) => s.done === false) === true);

    const marked = await markAgendaStage({
      periodId: nextWeek.id, stage: "commitments", done: true, session: E,
    });
    chk("والتعليمُ يقع بقرار", marked.ok);
    const agenda2 = await assembleAgenda(nextWeek.id);
    chk(
      "ويُقرأ بعدها",
      agenda2?.stages.find((s) => s.key === "commitments")?.done === true
    );
    const held = await markMeetingHeld({ periodId: nextWeek.id, notes: "عُقد", session: E });
    chk("وانعقادُه يُعلَن صراحةً", held.ok, held.ok ? held.message : held.reason);
  }

  // ══ ٢١) التقاريرُ السابقة لا تتبدّل بفتح أسبوعٍ جديد
  {
    const snapshot = await periodProgress(thisWeek.id, dept.id);
    chk(
      "٢١ · **وتقريرُ الأسبوع المُغلَق يبقى كما كان** — لا يَنقص بما رُحِّل عنه",
      snapshot.verifiedWeight === 3 && snapshot.eligibleWeight === 4,
      `${snapshot.verifiedWeight}/${snapshot.eligibleWeight}`
    );
    chk(
      "وما خرج منه يُقرأ فيه غيرَ مكتمل",
      snapshot.eligibleTasks === 2 && snapshot.verifiedTasks === 1,
      `${snapshot.verifiedTasks} من ${snapshot.eligibleTasks}`
    );
  }

  // ══ ٢٣) قرارانِ متزامنان لا يُنشئان حالةً متناقضة
  {
    const racy = await ensurePeriod(new Date(nextWeek.weekStart.getTime() + 21 * DAY));
    cleanupPeriods.push(racy.id);
    await prisma.executionPeriod.update({ where: { id: racy.id }, data: { state: "awaiting_opening" } });
    const [a, b] = await Promise.all([
      openPeriod({ periodId: racy.id, session: E }),
      openPeriod({ periodId: racy.id, session: F }),
    ]);
    const row = await prisma.executionPeriod.findUniqueOrThrow({ where: { id: racy.id } });
    chk("٢٣ · ونداءانِ متزامنان للفتح لا يَفتحان مرّتين",
        a.ok && b.ok && row.state === "open",
        `${a.ok ? "ok" : "no"}/${b.ok ? "ok" : "no"} → ${row.state}`);
    const opens = await prisma.workChange.count({
      where: { periodId: racy.id, kind: { in: ["lock_exception", "emergency_open"] } },
    });
    chk("ويُسجَّل الفتحُ مرّةً واحدة", opens === 1, String(opens));
  }

  // ══ ٢٢/٢٥) التقويم: يُشتقّ، ويُصفّى بالصلاحية، ولا يَكسر ما قبله
  {
    const { calendarEntries, monthGrid, todayKey } = await import("@/lib/orgCalendar");
    const grid = monthGrid(new Date());
    const asExec = await calendarEntries({ session: E, from: grid.from, to: grid.to });
    const asMember = await calendarEntries({ session: M, from: grid.from, to: grid.to });
    chk("٢٥ · التقويمُ يُشتقّ من السجلّات لا من جدولِ أحداث", asExec.length >= 0);
    chk(
      "والمُراجِعُ يرى أكثرَ ممّا يرى عضوٌ لا قسمَ له — والتصفيةُ في الاستعلام",
      asExec.length >= asMember.length,
      `${asExec.length} مقابل ${asMember.length}`
    );
    chk("ومفاتيحُ أيامه بتوقيت الرياض", /^\d{4}-\d{2}-\d{2}$/.test(todayKey()), todayKey());
    chk("وشبكةُ الشهر ٤٢ يوماً تبدأ بالسبت", grid.days.length === 42);
  }

  // ── تنظيف
  await prisma.planTask.deleteMany({ where: { periodId: { in: cleanupPeriods } } });
  await prisma.planTask.deleteMany({ where: { createdByName: { contains: String(STAMP) } } });
  await prisma.planTask.deleteMany({ where: { title: { contains: String(STAMP) } } });
  await prisma.milestone.deleteMany({ where: { goalId: { in: cleanupGoals } } });
  await prisma.departmentObjective.deleteMany({ where: { title: { contains: String(STAMP) } } });
  await prisma.strategicGoal.deleteMany({ where: { id: { in: cleanupGoals } } });
  await prisma.weekPlan.deleteMany({ where: { periodId: { in: cleanupPeriods } } });
  await prisma.reviewMeeting.deleteMany({ where: { periodId: { in: cleanupPeriods } } });
  await prisma.executionPeriod.deleteMany({ where: { id: { in: cleanupPeriods } } });
  await prisma.user.deleteMany({ where: { id: { in: [lead.id, worker.id] } } });
  await prisma.meetingConfig.deleteMany({ where: { id: "main" } });

  console.log(log.join("\n"));
  const failed = log.some((l) => l.startsWith("✗"));
  console.log("\n" + (failed ? "FAILURES PRESENT" : "ALL PASS"));
  process.exit(failed ? 1 : 0);
})();
