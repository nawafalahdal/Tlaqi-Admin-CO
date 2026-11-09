import { prisma } from "@/lib/prisma";
import { appendMemberEvent } from "@/lib/googleSheets";
import { buildXlsx, type XlsxCell } from "@/lib/xlsx";
import { canManageOnboardingSurvey, onboardingRows, SURVEY_STATUS_LABEL, type OnboardingRow, type SurveyActor } from "@/lib/onboardingSurvey";

/** **تصديرُ استبيان الانضمام إلى Excel** — للمؤسس والرئيس التنفيذي ومسؤول التشغيل وحدهم،
 *  وكلُّ تصديرٍ يُسجَّل (من، ومتى، وكم صفّاً) في القاعدة وفي السجل الحي. */

export const EXPORT_KIND = "onboarding_survey";

export const ONBOARDING_EXPORT_COLUMNS = [
  { header: "اسم العضو", width: 26 },
  { header: "البريد الإلكتروني", width: 30 },
  { header: "القسم", width: 18 },
  { header: "المسمى الوظيفي", width: 22 },
  { header: "تاريخ الاعتماد النهائي", width: 20 },
  { header: "تقييم سهولة رحلة الانضمام", width: 14 },
  { header: "تقييم وضوح الدور", width: 14 },
  { header: "وصول البنر", width: 12 },
  { header: "الجنس", width: 10 },
  { header: "تاريخ إكمال الاستبيان", width: 20 },
  { header: "حالة الإكمال", width: 22 },
] as const;

export function onboardingExportRow(r: OnboardingRow): XlsxCell[] {
  const c = r.current;
  return [
    r.fullName,
    r.email,
    r.department?.name ?? "—",
    r.jobTitle ?? "",
    r.decidedAt,
    c?.journeyRating ?? null,
    c?.roleClarityRating ?? null,
    c ? (c.bannerReceived ? "نعم" : "لا") : "",
    c ? (c.gender === "female" ? "أنثى" : "ذكر") : "",
    c?.submittedAt ?? null,
    SURVEY_STATUS_LABEL[r.status],
  ];
}

export async function exportOnboardingSurvey(actor: SurveyActor, now = new Date()) {
  if (!canManageOnboardingSurvey(actor.role)) return { ok: false as const, reason: "ليس لك تصديرُ بيانات الاستبيان" };
  const rows = await onboardingRows();
  const file = buildXlsx({
    sheetName: "استبيان الانضمام",
    columns: [...ONBOARDING_EXPORT_COLUMNS],
    rows: rows.map(onboardingExportRow),
    rtl: true,
  });
  await prisma.dataExportLog.create({
    data: { kind: EXPORT_KIND, actorId: actor.id, actorName: actor.name, actorRole: actor.role, rowCount: rows.length, createdAt: now },
  });
  try {
    await appendMemberEvent({
      fullName: actor.name,
      email: actor.email ?? "",
      roleOrDepartment: actor.role,
      event: "تصدير بيانات استبيان الانضمام",
      details: `${rows.length} صفّاً — Excel`,
      at: now,
    });
  } catch (e) {
    console.error("[onboarding-export] sheet event", e instanceof Error ? e.name : typeof e);
  }
  const stamp = now.toISOString().slice(0, 10);
  return { ok: true as const, file, rowCount: rows.length, filename: `tlaqi-onboarding-survey-${stamp}.xlsx` };
}
