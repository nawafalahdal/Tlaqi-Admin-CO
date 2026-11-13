import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeTabSnapshot, formatSheetDate } from "@/lib/googleSheets";
import { buildXlsxWorkbook, type XlsxCell } from "@/lib/xlsx";
import { employeeIdLabel } from "@/lib/employeeId";
import { SENIOR_CAPABILITIES, INVITE_STATE_LABEL, POSITION_STATUS_LABEL } from "./senior";
import { BASIS_LABEL, type SeniorLeaderBasis } from "./leadership";
import { orgAr } from "@/i18n/dictionaries/org.ar";

/** **مزامنةُ الحوكمة مع السجل الحي (Google Sheets) وتصديرُها إلى Excel — من مصدرٍ واحد.**
 *
 *  - **القاعدةُ مصدرُ الحقيقة:** كلُّ تبويبٍ لقطةٌ كاملةٌ تُعاد كتابتُها منها (`writeTabSnapshot`) — لا صفوفَ
 *    تُلحَق فتتكرّر أو تتعارض، ولا نسخٌ متفرّقة. والمعرّفُ في العمود الأول معرّفُ القاعدة نفسه في الملفين.
 *  - **لا يُحذف القديم:** اللجانُ المؤرشفة والتكليفاتُ المنتهية والدعواتُ الملغاة صفوفٌ بحالتها.
 *  - **التعثّرُ لا يُفقد شيئاً:** البياناتُ في القاعدة؛ والتبويبُ يُكتب ثم يُمسح ما بعده (لا لحظةَ فراغ)؛
 *    وكلُّ تشغيلٍ يُسجَّل في `GovernanceSyncRun` بنتيجته وسببِ فشله، والتشغيلُ التالي يُعيد اللقطة كاملة.
 *  - **لا تشغيلان معاً:** حجزٌ ذرّيٌّ بقفلٍ في القاعدة؛ ومن وجد تشغيلاً جارياً يتركه — ويُعيد الجاري الكرّةَ
 *    إن جدّ حدثٌ بعد بدايته، فلا يفوته تغيير. */

const CAP_LABEL = Object.fromEntries(SENIOR_CAPABILITIES.map((c) => [c.key, c.label]));
const STATUS = orgAr.statuses as Record<string, string>;
const SEAT: Record<string, string> = { super_admin: "المؤسس", executive: "الرئيس التنفيذي", operations_officer: "مسؤول التشغيل" };
const LOG_LIMIT = 5000;
const STALE_MS = 5 * 60_000;

const d = (x: Date | null | undefined) => (x ? formatSheetDate(x) : "");
const json = (v: Prisma.JsonValue | null) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.entries(v).map(([k, x]) => `${k}: ${x === null ? "—" : typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(" · ").slice(0, 1000)
    : v == null ? "" : String(v);

export type GovernanceTables = {
  senior: (string | number)[][];
  committees: (string | number)[][];
  log: (string | number)[][];
  /** للتصدير: تواريخُ حقيقية (تُفرَز في Excel) */
  xlsx: { senior: XlsxCell[][]; committees: XlsxCell[][]; log: XlsxCell[][] };
};

/** الجداولُ الثلاثة من القاعدة — للسجل الحي وللتصدير معاً */
export async function governanceTables(): Promise<GovernanceTables> {
  const [seniorDept, seats, positions, committees, events] = await Promise.all([
    prisma.department.findFirst({ where: { leadershipOnly: true, parentId: null }, select: { seniorLeaderUserId: true, seniorLeaderBasis: true, seniorLeaderSince: true } }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ["super_admin", "executive", "operations_officer"] } },
      select: { id: true, fullName: true, email: true, role: true, jobTitle: true, createdAt: true, employeeNo: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.seniorPosition.findMany({
      include: { holderMember: { select: { fullName: true, email: true, employeeNo: true } }, holderUser: { select: { fullName: true, email: true, employeeNo: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // department-scope: all — تبويبُ «اللجان» سجلٌّ كامل: المؤرشفةُ والمغلقةُ والمقترحةُ صفوفٌ بحالتها، لا يُحذف شيء
    prisma.department.findMany({
      where: { parentId: { not: null }, committeeStatus: { not: null } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, description: true, purpose: true, expectedOutputs: true, createdAt: true, committeeStatus: true,
        statusChangedAt: true, statusNote: true, archivedFromStatus: true, leadAssignedAt: true, leadAssignedByName: true,
        parent: { select: { name: true } },
        leadMember: { select: { fullName: true } },
        actingLeadUser: { select: { fullName: true } },
        committeeMemberships: { where: { active: true }, select: { member: { select: { fullName: true } } }, orderBy: { addedAt: "asc" } },
        committeeTasks: { select: { status: true } },
        _count: { select: { committeeMeetings: true, committeeDecisions: true } },
      },
    }),
    prisma.orgAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: LOG_LIMIT }),
  ]);

  const seniorX: XlsxCell[][] = [
    ...seats.map((u) => {
      const leader = seniorDept?.seniorLeaderUserId === u.id;
      return [
        u.id, u.fullName, employeeIdLabel(u.employeeNo) ?? "—", u.email, SEAT[u.role] ?? u.role, "",
        leader ? `${SEAT[u.role]} — قائد الإدارة العليا (${BASIS_LABEL[seniorDept!.seniorLeaderBasis as SeniorLeaderBasis] ?? ""})` : SEAT[u.role] ?? u.role,
        u.jobTitle ?? "", "كلُّ صلاحيات الدور", u.createdAt, "نشط", "—", "—",
        leader && seniorDept?.seniorLeaderSince ? `يقود منذ ${d(seniorDept.seniorLeaderSince)}` : "",
      ] as XlsxCell[];
    }),
    ...positions.map((p) => [
      p.id,
      p.holderMember?.fullName ?? p.holderUser?.fullName ?? p.inviteName,
      employeeIdLabel(p.holderMember?.employeeNo ?? p.holderUser?.employeeNo) ?? "—",
      p.holderMember?.email ?? p.holderUser?.email ?? p.inviteEmail,
      p.titleAr, p.titleEn ?? "", "منصبٌ بتكليف", p.responsibilities ?? "",
      p.capabilities.map((c) => CAP_LABEL[c] ?? c).join("، "),
      p.startDate ?? p.acceptedAt ?? null,
      POSITION_STATUS_LABEL[p.status], INVITE_STATE_LABEL[p.inviteState] ?? p.inviteState, p.invitedByName,
      [p.notes, p.cancelReason && `أُلغيت: ${p.cancelReason}`, p.endReason && `انتهى: ${p.endReason}`].filter(Boolean).join(" · "),
    ] as XlsxCell[]),
  ];

  const committeesX: XlsxCell[][] = committees.map((c) => {
    const open = c.committeeTasks.filter((t) => t.status === "todo" || t.status === "in_progress").length;
    const archived = c.committeeStatus === "archived";
    return [
      c.id, c.name, c.parent?.name ?? "", c.description ?? c.purpose ?? "", c.expectedOutputs ?? "",
      c.leadMember?.fullName ?? (c.actingLeadUser ? `${c.actingLeadUser.fullName} (بالخلافة)` : "— بلا قائد"),
      c.committeeMemberships.map((m) => m.member.fullName).join("، "),
      c.createdAt, c.leadAssignedAt ?? null, c.leadAssignedByName ?? "",
      STATUS[c.committeeStatus!] ?? c.committeeStatus!, archived ? "نعم" : "لا", archived ? c.statusChangedAt ?? null : null,
      `${open} / ${c.committeeTasks.length}`, c._count.committeeMeetings, c._count.committeeDecisions,
      [c.statusNote, archived && c.archivedFromStatus ? `أُرشِفت وهي «${STATUS[c.archivedFromStatus]}»` : null].filter(Boolean).join(" · "),
    ];
  });

  const logX: XlsxCell[][] = events.map((e) => [
    e.id, e.createdAt, e.scope, e.action, e.actorName, e.actorRole ?? "", e.entityId, json(e.before), json(e.after), e.note ?? "",
    e.result === "denied" ? "مرفوضة" : "نُفِّذت",
  ]);

  const text = (rows: XlsxCell[][]) => rows.map((r) => r.map((v) => (v instanceof Date ? d(v) : v == null ? "" : v)) as (string | number)[]);
  return { senior: text(seniorX), committees: text(committeesX), log: text(logX), xlsx: { senior: seniorX, committees: committeesX, log: logX } };
}

/** **ملفُّ Excel للحوكمة** — الأوراقُ الثلاث نفسُها بأعمدة السجل الحي، وورقةُ «عن الملف» بالمصدر ووقت التصدير */
export async function governanceWorkbook(): Promise<Buffer> {
  const t = await governanceTables();
  const cols = (h: string[]) => h.map((header) => ({ header, width: Math.min(40, Math.max(14, header.length + 6)) }));
  return buildXlsxWorkbook({
    sheets: [
      { sheetName: "الإدارة العليا", columns: cols(["المعرّف", "الاسم", "الرقم الوظيفي", "البريد الإلكتروني", "المسمّى (عربي)", "المسمّى (إنجليزي)", "الصفة", "المسؤوليات", "الصلاحيات", "تاريخ الانضمام / البدء", "حالة التكليف", "حالة الدعوة", "دعاه", "ملاحظات"]), rows: t.xlsx.senior },
      { sheetName: "اللجان", columns: cols(["المعرّف", "اسم اللجنة", "القسم", "الوصف", "الأهداف", "القائد", "الأعضاء", "تاريخ الإنشاء", "تاريخ تعيين القائد", "عيّنه", "الحالة", "مؤرشفة؟", "تاريخ الأرشفة", "المهام (مفتوحة / الكل)", "الاجتماعات", "القرارات", "ملاحظات"]), rows: t.xlsx.committees },
      { sheetName: "سجل الحوكمة", columns: cols(["المعرّف", "التاريخ", "النطاق", "الإجراء", "الفاعل", "دوره وقتها", "الهدف", "قبل", "بعد", "السبب", "النتيجة"]), rows: t.xlsx.log },
      {
        sheetName: "عن الملف",
        columns: [{ header: "البند", width: 24 }, { header: "القيمة", width: 70 }],
        rows: [
          ["المصدر", "قاعدة بيانات منصة TLAQI — مصدر الحقيقة"],
          ["وقت التصدير", new Date()],
          ["ملاحظة", "لقطةٌ للقراءة. التعديلُ في المنصة وحدها، وسجلُّ الحوكمة لا يُعدَّل."],
          ["حدُّ السجل", `أحدث ${LOG_LIMIT} حدث`],
        ],
      },
    ],
  });
}

/** **مزامنةُ تبويبات الحوكمة** — تُسجَّل في `GovernanceSyncRun`. لا ترمي: نتيجتُها في ما تُرجعه وفي السجل. */
export async function syncGovernanceSheets(trigger: string, depth = 0): Promise<{ ok: boolean; skipped?: "running" | "disabled"; rows?: number; error?: string }> {
  // حجزٌ ذرّي: لا تشغيلان معاً (والتشغيلُ العالقُ أكثرَ من خمس دقائق يُعدّ منتهياً)
  const run = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tlaqi:governance-sheets'))`;
    const busy = await tx.governanceSyncRun.findFirst({ where: { finishedAt: null, startedAt: { gt: new Date(Date.now() - STALE_MS) } }, select: { id: true } });
    if (busy) return null;
    return tx.governanceSyncRun.create({ data: { trigger: trigger.slice(0, 200) }, select: { id: true, startedAt: true } });
  });
  if (!run) return { ok: false, skipped: "running" };
  try {
    const t = await governanceTables();
    const stamp = `آخر تحديث: ${formatSheetDate(new Date())} · المصدر: قاعدة بيانات المنصة — لا تُعدَّل هنا`;
    const a = await writeTabSnapshot("الإدارة العليا", t.senior, stamp);
    if (a.skipped) {
      await prisma.governanceSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error: "تكامل Google Sheets غير مضبوط في هذه البيئة" } });
      return { ok: false, skipped: "disabled" };
    }
    await writeTabSnapshot("اللجان", t.committees, stamp);
    await writeTabSnapshot("سجل الحوكمة", t.log, stamp);
    const rows = t.senior.length + t.committees.length + t.log.length;
    await prisma.governanceSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, rows } });
    // جدّ حدثٌ أثناء التشغيل؟ لقطةٌ أخرى (مرّةً واحدة) — فلا يفوت تغييرٌ تُرك لأن تشغيلاً كان جارياً
    if (depth === 0 && (await prisma.orgAuditEvent.count({ where: { createdAt: { gt: run.startedAt } } })) > 0) {
      return syncGovernanceSheets(`${trigger} (إعادة لأحداثٍ جدّت)`, 1);
    }
    return { ok: true, rows };
  } catch (err) {
    // لا يُكتب نصُّ الخطأ الخام (قد يحمل تفاصيل الاتصال) — اسمُه ورمزُه فقط
    const e = err as { name?: string; code?: unknown; status?: unknown };
    const error = `${e?.name ?? "Error"}${e?.code ? ` (${String(e.code)})` : e?.status ? ` (${String(e.status)})` : ""}`;
    await prisma.governanceSyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error } }).catch(() => {});
    console.error("تعذّرت مزامنةُ تبويبات الحوكمة:", error);
    return { ok: false, error };
  }
}

/** **بعد الإجراء الحاكم:** تُجدول المزامنةُ بعد إرسال الردّ (`after`) — فلا ينتظرها المستخدم ولا يفشل إجراؤه
 *  بفشلها. وخارج طلبٍ (فحصٌ أو سكربت) لا تُجدول. */
export async function queueGovernanceSync(trigger: string) {
  try {
    const { after } = await import("next/server");
    after(() => syncGovernanceSheets(trigger).then(() => undefined));
  } catch {
    /* خارج سياق طلب — يلتقطها الكنسُ الدوري */
  }
}
