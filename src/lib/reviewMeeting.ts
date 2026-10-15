import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
import { fromRiyadhParts, toRiyadh, RIYADH_TZ } from "@/lib/riyadh";
import {
  canGovernPeriod,
  previousPeriod,
  unresolvedReviewCount,
  OUTSTANDING_STATES,
} from "@/lib/execution";
import { periodProgress } from "@/lib/progress";
import { repeatedCarryovers, CARRYOVER_ESCALATION } from "@/lib/carryover";

/** اجتماعُ المراجعة الأسبوعي وأجندتُه.
 *
 *  ## لا ساعةَ مكتوبةٌ في الكود
 *
 *  يومُ الاجتماع وساعتُه ومدّتُه ومنطقتُه ومُنظّمُه ورابطُه — كلُّها في
 *  صفِّ إعداداتٍ واحد يُغيّره المُصرَّحُ له. والافتراضُ سبتٌ بتوقيت
 *  الرياض، **وهو افتراضٌ لا قانون**: مكتوبٌ في القاعدة لا في شرطٍ
 *  داخل الكود، فتغييرُه لا يحتاج نشراً.
 *
 *  ## ولا يُنشَأ اجتماعانِ لأسبوع
 *
 *  التفرّدُ على `periodId` يَمنع التكرار مهما نودِيت الدالّة — والكنسُ
 *  اليوميُّ يُناديها كلَّ ليلة.
 *
 *  ## ومرورُ الوقت لا يَعقد اجتماعاً
 *
 *  الاجتماعُ يبقى `scheduled` حتى يُعلَن انعقادُه صراحةً. فلو انقضى
 *  موعدُه ولم يُعقَد بقي **مستحقّاً ظاهراً** لا منتهياً صامتاً — وهذا
 *  نفسُ المبدأ الذي يَمنع فتحَ الأسبوع بمرور التقويم.
 */

export type MeetingSettings = {
  weekday: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  timezone: string;
  organizerName: string | null;
  locationOrUrl: string | null;
  agendaTemplate: string | null;
};

const FALLBACK: MeetingSettings = {
  weekday: 6,
  hour: 21,
  minute: 0,
  durationMinutes: 60,
  timezone: RIYADH_TZ,
  organizerName: null,
  locationOrUrl: null,
  agendaTemplate: null,
};

/** الإعداداتُ كما هي — ولا تُكتَب عند القراءة */
export async function meetingSettings(): Promise<MeetingSettings> {
  const row = await prisma.meetingConfig.findUnique({ where: { id: "main" } });
  if (!row) return FALLBACK;
  return {
    weekday: row.weekday,
    hour: row.hour,
    minute: row.minute,
    durationMinutes: row.durationMinutes,
    timezone: row.timezone,
    organizerName: row.organizerName,
    locationOrUrl: row.locationOrUrl,
    agendaTemplate: row.agendaTemplate,
  };
}

export async function saveMeetingSettings(opts: {
  weekday: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  organizerName?: string | null;
  locationOrUrl?: string | null;
  agendaTemplate?: string | null;
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "إعداداتُ الاجتماع للمدير التنفيذي — ومعه المؤسس" };
  }
  if (opts.weekday < 0 || opts.weekday > 6) return { ok: false, reason: "يومُ الأسبوع بين ٠ و٦" };
  if (opts.hour < 0 || opts.hour > 23) return { ok: false, reason: "الساعة بين ٠ و٢٣" };
  if (opts.minute < 0 || opts.minute > 59) return { ok: false, reason: "الدقيقة بين ٠ و٥٩" };
  if (opts.durationMinutes < 15 || opts.durationMinutes > 480) {
    return { ok: false, reason: "المدّة بين ١٥ دقيقة و٨ ساعات" };
  }
  const url = opts.locationOrUrl?.trim() || null;
  if (url && /^https?:/i.test(url) && !/^https:/i.test(url)) {
    return { ok: false, reason: "رابطُ الاجتماع يبدأ بـhttps://" };
  }

  await prisma.meetingConfig.upsert({
    where: { id: "main" },
    create: {
      id: "main",
      weekday: opts.weekday,
      hour: opts.hour,
      minute: opts.minute,
      durationMinutes: opts.durationMinutes,
      timezone: RIYADH_TZ,
      organizerId: opts.session.user.id,
      organizerName: opts.organizerName?.trim() || opts.session.user.name || null,
      locationOrUrl: url,
      agendaTemplate: opts.agendaTemplate?.trim() || null,
      updatedByName: opts.session.user.name ?? "—",
    },
    update: {
      weekday: opts.weekday,
      hour: opts.hour,
      minute: opts.minute,
      durationMinutes: opts.durationMinutes,
      organizerName: opts.organizerName?.trim() || undefined,
      locationOrUrl: url,
      agendaTemplate: opts.agendaTemplate?.trim() || null,
      updatedByName: opts.session.user.name ?? "—",
    },
  });
  return { ok: true };
}

/** موعدُ اجتماعِ فترةٍ: أولُ يومِ اجتماعٍ داخل أسبوعها بساعته المضبوطة */
export function meetingTimeFor(weekStart: Date, settings: MeetingSettings): Date {
  const r = toRiyadh(weekStart);
  const startDay = r.getUTCDay();
  // الأسبوعُ يبدأ ليلةَ السبت، واجتماعُ مراجعته هو اجتماعُ **نهايته**:
  // فيُحسَب أولُ يومِ اجتماعٍ يقع بعد بدايته بيومٍ على الأقل
  let delta = (settings.weekday - startDay + 7) % 7;
  if (delta === 0) delta = 7;
  return fromRiyadhParts(
    r.getUTCFullYear(),
    r.getUTCMonth(),
    r.getUTCDate() + delta,
    settings.hour,
    settings.minute
  );
}

/** يُنشئ اجتماعَ فترةٍ إن لم يكن — ولا يُكرِّره */
export async function ensureMeeting(periodId: string) {
  const period = await prisma.executionPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, weekStart: true },
  });
  if (!period) return null;

  const existing = await prisma.reviewMeeting.findUnique({ where: { periodId } });
  if (existing) return existing;

  const settings = await meetingSettings();
  try {
    return await prisma.reviewMeeting.create({
      data: {
        periodId,
        scheduledAt: meetingTimeFor(period.weekStart, settings),
        durationMinutes: settings.durationMinutes,
        timezone: settings.timezone,
        organizerName: settings.organizerName,
        locationOrUrl: settings.locationOrUrl,
      },
    });
  } catch {
    return prisma.reviewMeeting.findUniqueOrThrow({ where: { periodId } });
  }
}

/** مراحلُ الأجندة العشر — تُعلَّم صراحةً ولا تُستنتَج من مرور الوقت */
export const AGENDA_STAGES = [
  { key: "commitments", label: "مراجعةُ التزامات الأسبوع الماضي" },
  { key: "evidence", label: "فحصُ التسليمات وأدلّتها" },
  { key: "verify", label: "التحقّقُ من المنجَز" },
  { key: "incomplete", label: "تحديدُ غير المكتمل والمتأخّر والمعوَّق والمردود" },
  { key: "carryover", label: "المُرحَّلُ وخططُ تصحيحه" },
  { key: "departments", label: "أداءُ الأقسام وأحمالُها" },
  { key: "dependencies", label: "التبعيّاتُ والقرارات التنفيذية" },
  { key: "nextPlan", label: "عرضُ خطة الأسبوع القادم" },
  { key: "ownership", label: "تثبيتُ المسؤوليات والأولويات والمواعيد" },
  { key: "open", label: "الإذنُ بفتح الأسبوع" },
] as const;

export type AgendaStageKey = (typeof AGENDA_STAGES)[number]["key"];

/** يَجمع أجندةَ المراجعة من الحقيقة المسجَّلة لا من إدخالٍ يدوي */
export async function assembleAgenda(periodId: string) {
  const period = await prisma.executionPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, weekStart: true, weekEnd: true, state: true },
  });
  if (!period) return null;

  const prev = await previousPeriod(period.weekStart);
  const meeting = await prisma.reviewMeeting.findUnique({ where: { periodId } });

  const [prevProgress, pendingVerification, blocked, overdue, repeated, deptPlans, unresolved] =
    await Promise.all([
      prev ? periodProgress(prev.id) : Promise.resolve(null),
      prev
        ? prisma.planTask.findMany({
            where: { periodId: prev.id, execState: "submitted" },
            orderBy: { dueAt: "asc" },
            select: {
              id: true,
              title: true,
              weight: true,
              dueAt: true,
              originalDueAt: true,
              carryoverCount: true,
              reportedByName: true,
              department: { select: { name: true, colorHex: true } },
              ownerUser: { select: { fullName: true } },
              ownerMember: { select: { fullName: true } },
              submissions: {
                orderBy: { submittedAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  note: true,
                  evidenceUrl: true,
                  evidenceFileName: true,
                  submittedAt: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      prev
        ? prisma.planTask.findMany({
            where: { periodId: prev.id, execState: "blocked" },
            select: {
              id: true,
              title: true,
              blockedReason: true,
              department: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      prisma.planTask.count({
        where: {
          execState: { in: OUTSTANDING_STATES },
          dueAt: { lt: new Date() },
        },
      }),
      repeatedCarryovers(),
      prisma.weekPlan.findMany({
        where: { periodId },
        select: {
          id: true,
          state: true,
          capacityPoints: true,
          overloadAcknowledged: true,
          department: { select: { id: true, name: true, colorHex: true } },
          _count: { select: { tasks: true } },
        },
      }),
      unresolvedReviewCount(periodId),
    ]);

  const stagesDone = (meeting?.stagesDoneJson as Record<string, boolean> | null) ?? {};

  return {
    period,
    previousPeriod: prev,
    meeting,
    prevProgress,
    pendingVerification,
    blocked,
    overdue,
    repeated,
    escalateAfter: CARRYOVER_ESCALATION.escalateAfter,
    deptPlans,
    unresolved,
    stages: AGENDA_STAGES.map((s) => ({ ...s, done: Boolean(stagesDone[s.key]) })),
  };
}

/** تعليمُ مرحلةٍ من الأجندة — صريحٌ ومُسجَّل */
export async function markAgendaStage(opts: {
  periodId: string;
  stage: AgendaStageKey;
  done: boolean;
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "إدارةُ الأجندة للمدير التنفيذي — ومعه المؤسس" };
  }
  const meeting = await ensureMeeting(opts.periodId);
  if (!meeting) return { ok: false, reason: "الفترة غير موجودة" };

  const current = (meeting.stagesDoneJson as Record<string, boolean> | null) ?? {};
  const next = { ...current, [opts.stage]: opts.done };
  await prisma.reviewMeeting.update({
    where: { id: meeting.id },
    data: { stagesDoneJson: next as Prisma.InputJsonValue },
  });
  return { ok: true };
}

/** إعلانُ انعقاد الاجتماع — ولا يقع بمرور موعده */
export async function markMeetingHeld(opts: {
  periodId: string;
  notes?: string | null;
  session: Session;
}): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "إعلانُ الانعقاد للمدير التنفيذي — ومعه المؤسس" };
  }
  const meeting = await ensureMeeting(opts.periodId);
  if (!meeting) return { ok: false, reason: "الفترة غير موجودة" };
  if (meeting.status === "held") return { ok: true, message: "الاجتماعُ مُعلَنٌ منعقداً سلفاً" };

  await prisma.reviewMeeting.update({
    where: { id: meeting.id },
    data: {
      status: "held",
      heldAt: new Date(),
      notes: opts.notes?.trim() || meeting.notes,
    },
  });
  return { ok: true, message: "سُجِّل انعقادُ الاجتماع" };
}

/** قرارُ اجتماعٍ ومتابعتُه — ولا يُغيّر بنفسه التزاماً معتمَداً */
export async function addMeetingDecision(opts: {
  periodId: string;
  text: string;
  ownerUserId?: string | null;
  dueAt?: Date | null;
  session: Session;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!canGovernPeriod(opts.session.user.role)) {
    return { ok: false, reason: "تسجيلُ القرارات للمدير التنفيذي — ومعه المؤسس" };
  }
  const text = opts.text.trim();
  if (!text) return { ok: false, reason: "نصُّ القرار مطلوب" };
  const meeting = await ensureMeeting(opts.periodId);
  if (!meeting) return { ok: false, reason: "الفترة غير موجودة" };

  const decision = await prisma.meetingDecision.create({
    data: {
      meetingId: meeting.id,
      text,
      ownerUserId: opts.ownerUserId ?? null,
      dueAt: opts.dueAt ?? null,
      createdByName: opts.session.user.name ?? "—",
    },
    select: { id: true },
  });
  return { ok: true, id: decision.id };
}

/** الاجتماعاتُ القادمة — للتقويم */
export async function upcomingMeetings(limit = 4) {
  return prisma.reviewMeeting.findMany({
    where: { status: { in: ["scheduled", "rescheduled"] } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: {
      id: true,
      scheduledAt: true,
      durationMinutes: true,
      locationOrUrl: true,
      status: true,
      period: { select: { id: true, weekStart: true, state: true } },
    },
  });
}

/** اجتماعٌ مستحقٌّ لم يُعقَد — يُعرَض ولا يُطوى بمرور وقته */
export async function overdueMeetings(now: Date = new Date()) {
  return prisma.reviewMeeting.findMany({
    where: { status: "scheduled", scheduledAt: { lt: now } },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      scheduledAt: true,
      period: { select: { id: true, weekStart: true, state: true } },
    },
  });
}
