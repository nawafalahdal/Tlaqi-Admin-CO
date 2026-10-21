// (هذا الملفُّ غيرُ `calendar.ts`: ذاك لروابط تقويم جوجل على التذاكر،
//  وهذا للتقويم الداخلي الموحَّد. وقد كتبتُ فوقه مرّةً فاستُعيد — والاسمُ
//  الآن يُفرّق بينهما.)
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { canReviewWork } from "@/lib/execution";
import { startOfRiyadhDay, riyadhDateKey, toRiyadh, fromRiyadhParts } from "@/lib/riyadh";

import { getDictionary, type Locale } from "@/i18n";
import { fmt } from "@/i18n/fmt";
/** التقويمُ الموحَّد — وكلُّ مدخلٍ فيه يُفضي إلى سجلّه الأصلي.
 *
 *  **ولا جدولَ أحداثٍ ثانٍ.** الحدثُ هنا **اشتقاقٌ** من الأهداف
 *  والمحطّات والمهامّ والاجتماعات والتذاكر: لو خُزِّن جدولُ أحداثٍ
 *  مستقلٌّ لاحتاج مزامنةً مع كل تغييرِ موعد — ويُنسى تحديثُه في فرعٍ
 *  واحدٍ فيَكذب التقويم.
 *
 *  **والصلاحيةُ تُفرَض في الاستعلام نفسِه:** العضوُ يرى مواعيدَه ومواعيدَ
 *  قسمه والاجتماعاتِ والأهدافَ المعتمَدة — لا مهامَّ الأقسام الأخرى.
 *  فالتصفيةُ في `where` لا بعد الجلب.
 */

export type CalendarEntry = {
  id: string;
  date: string;
  kind: "goal" | "milestone" | "task" | "meeting" | "ticket" | "period";
  title: string;
  detail: string | null;
  href: string;
  colorHex: string;
  overdue: boolean;
  /** هل هو التزامٌ مُرحَّل؟ — يُوسَم في التقويم كما يُوسَم في الخطة */
  carried: boolean;
};

const KIND_COLOR: Record<CalendarEntry["kind"], string> = {
  goal: "#341D2B",
  milestone: "#7A4EAB",
  task: "#C34900",
  meeting: "#1F6F8B",
  ticket: "#B38B2D",
  period: "#3F7D20",
};

export const KIND_LABEL: Record<CalendarEntry["kind"], string> = {
  goal: "هدف",
  milestone: "محطّة",
  task: "التزام",
  meeting: "اجتماع",
  ticket: "تذكرة",
  period: "أسبوع",
};

/** اسمُ النوع بلغة الواجهة — والثابتُ أعلاه بالعربية لمن يكتب سجلاً أو رسالة */
export function kindLabel(kind: CalendarEntry["kind"], locale: Locale = "ar"): string {
  return getDictionary(locale).libCalendar.kind[kind];
}

/** يَجمع مداخل التقويم في مدىً زمنيٍّ — بما يَحقّ لصاحب الجلسة */
export async function calendarEntries(opts: {
  session: Session;
  from: Date;
  to: Date;
  /** لغةُ نصوص المداخل — العربيةُ ما لم تُمرَّر */
  locale?: Locale;
}): Promise<CalendarEntry[]> {
  const L = getDictionary(opts.locale ?? "ar").libCalendar;
  const { session, from, to } = opts;
  const now = new Date();
  const isMember = session.user.role === "member";
  const reviewer = canReviewWork(session.user.role);
  const deptId = session.user.departmentId ?? null;

  const [goals, milestones, tasks, meetings, periods, tickets] = await Promise.all([
    prisma.strategicGoal.findMany({
      where: { status: { in: ["approved", "active"] }, dueDate: { gte: from, lte: to } },
      select: { id: true, title: true, dueDate: true, successCriteria: true },
    }),
    prisma.milestone.findMany({
      where: { dueDate: { gte: from, lte: to }, goal: { status: { in: ["approved", "active"] } } },
      select: { id: true, title: true, dueDate: true, expectedResult: true, goalId: true },
    }),
    prisma.planTask.findMany({
      where: {
        dueAt: { gte: from, lte: to },
        execState: { notIn: ["cancelled", "superseded"] },
        // من يُراجِع يرى الكلّ؛ وغيرُه يرى ما يخصّه: مهامَّه ومهامَّ قسمه
        ...(reviewer
          ? {}
          : {
              OR: [
                { ownerUserId: session.user.id },
                { ownerMemberId: session.user.id },
                ...(deptId ? [{ departmentId: deptId }] : []),
              ],
            }),
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        execState: true,
        carryoverCount: true,
        department: { select: { name: true, colorHex: true } },
        ownerUser: { select: { fullName: true } },
        ownerMember: { select: { fullName: true } },
      },
      take: 300,
    }),
    prisma.reviewMeeting.findMany({
      where: { scheduledAt: { gte: from, lte: to } },
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        durationMinutes: true,
        periodId: true,
      },
    }),
    // بداياتُ الأسابيع — تُعلِّم القارئَ أين يبدأ أسبوعُ التنفيذ
    prisma.executionPeriod.findMany({
      where: { weekStart: { gte: from, lte: to } },
      select: { id: true, weekStart: true, state: true },
    }),
    // ومواعيدُ التذاكر المفتوحة: هي أيضاً التزاماتٌ لها آجال، وإغفالُها
    // يجعل التقويمَ نصفَ تقويم. والتصفيةُ كتصفية المهامّ: من يُراجِع يرى
    // الكلَّ، وغيرُه ما وُجِّه إليه أو إلى قسمه.
    prisma.ticket.findMany({
      where: {
        status: { not: "resolved" },
        stageDueAt: { gte: from, lte: to },
        ...(reviewer
          ? {}
          : {
              OR: [
                { targetUserId: session.user.id },
                { targetMemberId: session.user.id },
                { raisedByUserId: session.user.id },
                { memberId: session.user.id },
                ...(deptId ? [{ targetDepartmentId: deptId }] : []),
              ],
            }),
      },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        stageDueAt: true,
        targetDepartment: { select: { name: true, colorHex: true } },
      },
      take: 120,
    }),
  ]);

  const entries: CalendarEntry[] = [];

  for (const g of goals) {
    entries.push({
      id: `goal:${g.id}`,
      date: riyadhDateKey(g.dueDate),
      kind: "goal",
      title: g.title,
      detail: g.successCriteria,
      href: "/admin/execution/goals",
      colorHex: KIND_COLOR.goal,
      overdue: g.dueDate < now,
      carried: false,
    });
  }
  for (const m of milestones) {
    entries.push({
      id: `ms:${m.id}`,
      date: riyadhDateKey(m.dueDate),
      kind: "milestone",
      title: m.title,
      detail: m.expectedResult,
      href: "/admin/execution/goals",
      colorHex: KIND_COLOR.milestone,
      overdue: m.dueDate < now,
      carried: false,
    });
  }
  for (const t of tasks) {
    const closed = ["verified", "waived", "deferred"].includes(t.execState);
    entries.push({
      id: `task:${t.id}`,
      date: riyadhDateKey(t.dueAt),
      kind: "task",
      title: t.title,
      detail: `${t.department?.name ?? "—"} · ${t.ownerUser?.fullName ?? t.ownerMember?.fullName ?? L.noOwner}`,
      href: isMember ? "/member" : "/admin/execution",
      colorHex: t.department?.colorHex ?? KIND_COLOR.task,
      overdue: !closed && t.dueAt < now,
      carried: t.carryoverCount > 0,
    });
  }
  for (const m of meetings) {
    entries.push({
      id: `meet:${m.id}`,
      date: riyadhDateKey(m.scheduledAt),
      kind: "meeting",
      title: L.weeklyReviewMeeting,
      detail: fmt(L.meetingDetail, m.durationMinutes, m.status === "held" ? L.held : L.notHeld),
      href: reviewer ? "/admin/execution/review" : "/calendar",
      colorHex: KIND_COLOR.meeting,
      overdue: m.status === "scheduled" && m.scheduledAt < now,
      carried: false,
    });
  }
  for (const t of tickets) {
    entries.push({
      id: `ticket:${t.id}`,
      date: riyadhDateKey(t.stageDueAt),
      kind: "ticket",
      title: fmt(L.ticket, t.ticketNumber, t.subject),
      detail: t.targetDepartment?.name ?? null,
      href: `/t/${t.ticketNumber}`,
      colorHex: KIND_COLOR.ticket,
      overdue: t.stageDueAt < now,
      carried: false,
    });
  }
  for (const p of periods) {
    entries.push({
      id: `period:${p.id}`,
      date: riyadhDateKey(p.weekStart),
      kind: "period",
      title: L.startOfTheExecution,
      detail: null,
      href: isMember ? "/member" : "/admin/execution",
      colorHex: KIND_COLOR.period,
      overdue: false,
      carried: false,
    });
  }

  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** شبكةُ شهرٍ بتوقيت الرياض: ستُّ صفوفٍ من سبعة أيام */
export function monthGrid(anchor: Date) {
  const r = toRiyadh(anchor);
  const year = r.getUTCFullYear();
  const month = r.getUTCMonth();
  const first = fromRiyadhParts(year, month, 1);
  const firstDay = toRiyadh(first).getUTCDay();
  // الأسبوعُ يبدأ بالسبت في التقويم العربي
  const lead = (firstDay - 6 + 7) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);

  const days: { date: Date; key: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    days.push({
      date: d,
      key: riyadhDateKey(d),
      inMonth: toRiyadh(d).getUTCMonth() === month,
    });
  }
  return { year, month, days, from: start, to: new Date(start.getTime() + 42 * 86_400_000) };
}

export const MONTH_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** اسمُ الشهر بلغة الواجهة (٠ = يناير) */
export function monthName(month: number, locale: Locale = "ar"): string {
  return getDictionary(locale).libCalendar.months[`m${month}` as keyof ReturnType<typeof getDictionary>["libCalendar"]["months"]] ?? "";
}

export function todayKey() {
  return riyadhDateKey(startOfRiyadhDay());
}
