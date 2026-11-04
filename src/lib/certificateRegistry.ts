import type { InviteTargetRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAND } from "@/lib/brand";
import { appendMemberEvent } from "@/lib/googleSheets";
import { appBaseUrl } from "@/lib/emailBrand";
import { roleTitle } from "@/lib/gender";
import { anniversaryDate, completedThreeMonths, orgCalendarDate } from "@/lib/anniversary";
import { earnsFinalCertificate, registryCertificateUrl, servicePeriod } from "@/lib/certificate";
import { mayIssueCertificateFor } from "@/lib/recognitionDesk";
import {
  actualDuration,
  buildView,
  defaultFields,
  fieldEdits,
  FIELD_SPECS,
  missingFields,
  occasionFor,
  TYPE_INFO,
  CERTIFICATE_TYPES,
  type CertificateFields,
  type CertificateType,
  type CertificateView,
  type RecipientFacts,
} from "@/lib/certificateTypes";

/** **سجلُّ الشهادات الصادرة** — كلُّ شهادةٍ برقمها ولقطتها ومن أصدرها ومتى.
 *
 *  ثلاثة أبوابٍ تكتب فيه، وكلُّها هنا:
 *  - **اليدوي** (`issueCertificate`): من «الترحيب والتكريم» بالسلسلة نفسها — مسؤول
 *    التشغيل للقادة والأعضاء، والتنفيذي لمسؤول التشغيل، والمؤسس للتنفيذي.
 *  - **الآلي** (`registerAutomatic`): كنسُ الثلاثة أشهر، وختامُ التجربة — يُسجَّل
 *    «آلياً» أو باسم من سجّل خطوة الختام.
 *
 *  **لا تكرار لمناسبةٍ واحدة:** `(memberId, occasion)` فريدان في القاعدة. والنوعان
 *  القديمان (تقدير الثلاثة أشهر، الشكر والخبرة) يُختمان أيضاً في ملف العضو
 *  (`appreciationIssuedAt`، `certificateIssuedAt`) بشرطٍ ذرّي — فلا يُصدر الكنسُ
 *  شهادةً لمن كُرِّم يدوياً قبله، ولا العكس.
 *
 *  **واللقطة ثابتة:** `data` تحفظ البياناتِ كما طُبعت، والموقِّعَين بتوقيعَيهما
 *  المعتمدين يوم الصدور. فالشهادةُ تُقرأ بعد سنةٍ كما صدرت، ولو بطل توقيعٌ بعدها
 *  («الصادر يبقى صحيحاً» — `signatures.ts`). */

export type IssueActor = { id: string; name: string; role: string };

export type SignerRef = {
  /** دورُ الموقِّع في الشهادة */
  seat: "founder" | "executive" | "department_lead";
  userId: string | null;
  title: string;
  name: string;
  signatureId: string | null;
};

type Snapshot = {
  v: 1;
  type: CertificateType;
  colorHex: string;
  departmentName: string | null;
  fields: CertificateFields;
  signers: [SignerRef, SignerRef];
};

const DEPT_CODES: Record<string, string> = {
  marketing: "MKT",
  tech: "TEC",
  technical: "TEC",
  hr: "HR",
  "senior-administration": "ADM",
};

/** رمزُ القسم في رقم الشهادة — واللجنةُ برمز قسمها */
export function departmentCode(d: { slug: string; parent?: { slug: string } | null } | null | undefined): string {
  if (!d) return "GEN";
  const slug = (d.parent?.slug ?? d.slug).toLowerCase();
  if (DEPT_CODES[slug]) return DEPT_CODES[slug];
  const latin = slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
  return latin.length >= 2 ? latin : "GEN";
}

/** بادئةُ الرقم: `TLAQI-MKT-2026-` ثم حرفُ النوع للقيادة والتعيين (`L-`، `A-`) */
export function numberPrefix(code: string, type: CertificateType, at = new Date()): string {
  const letter = TYPE_INFO[type].letter;
  return `TLAQI-${code}-${orgCalendarDate(at).year}-${letter ? `${letter}-` : ""}`;
}

/** حروفُ الأنواع في الأرقام — `TLAQI-MKT-2026-L-0003` يبدأ ببادئة `TLAQI-MKT-2026-` أيضاً */
const TYPE_LETTERS = [...new Set(Object.values(TYPE_INFO).map((i) => i.letter).filter((l): l is string => !!l))];

/** الرقمُ التالي بعد آخر رقمٍ صدر بهذه البادئة — لا يُعاد رقمٌ صدر.
 *
 *  وأرقامُ القيادة والتعيين (`…-L-0003`) تشترك في بادئة الأنواع بلا حرف، وترتيبُها
 *  النصّيّ فوق الأرقام — فتُستثنى صراحةً، وإلا قُرئ «L-0003» آخرَ رقمٍ عاديّ. */
async function nextNumber(db: Prisma.TransactionClient | typeof prisma, prefix: string, bump = 0): Promise<string> {
  const lettered = TYPE_LETTERS.some((l) => prefix.endsWith(`-${l}-`));
  const last = await db.issuedCertificate.findFirst({
    where: {
      number: { startsWith: prefix },
      ...(lettered ? {} : { NOT: TYPE_LETTERS.map((l) => ({ number: { startsWith: `${prefix}${l}-` } })) }),
    },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const tail = last ? Number(last.number.slice(prefix.length)) : 0;
  const seq = (Number.isFinite(tail) ? tail : 0) + 1 + bump;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

const MEMBER_INCLUDE = {
  department: { select: { id: true, name: true, slug: true, colorHex: true, parent: { select: { slug: true, name: true } } } },
  invite: { select: { targetRole: true } },
  committeesLed: { where: { parentId: { not: null } }, select: { name: true }, take: 1 },
} as const;

type MemberRow = Prisma.MemberGetPayload<{ include: typeof MEMBER_INCLUDE }>;

function factsOf(m: MemberRow, now = new Date()): RecipientFacts {
  const start = m.decidedAt ?? m.joinDate;
  const isLead = m.invite.targetRole !== "member";
  const period = servicePeriod(m, now);
  return {
    fullName: m.fullName,
    gender: m.gender,
    jobTitle: m.jobTitle,
    leadTitle: isLead ? roleTitle(m.invite.targetRole, m.gender, m.department?.name) : null,
    departmentName: m.department?.name ?? null,
    assignmentStart: start.toISOString(),
    appreciationDue: anniversaryDate(start, 3).toISOString(),
    completedThreeMonths: completedThreeMonths(start, now),
    serviceStart: period.start.toISOString(),
    serviceEnd: m.stepDownAt ? period.end.toISOString() : null,
    committeeName: m.committeesLed[0]?.name ?? null,
  };
}

/** الموقِّعان بحسب النوع وصاحب الشهادة — القاعدةُ نفسُها في `certificateFor`:
 *  العضوُ يوقّع له قائدُ قسمه والرئيسُ التنفيذي، والقائدُ والإدارةُ يوقّع لهم
 *  المؤسسُ والتنفيذي. وشهادةُ القيادة يوقّعها المؤسسُ والتنفيذي دائماً (لوحة 02d).
 *
 *  والتوقيعُ يُقرأ بالشخص لا بالمنصب: لا يُستعار توقيعُ من سبقه. */
async function resolveSigners(m: MemberRow, type: CertificateType) {
  const isLead = m.invite.targetRole !== "member";
  const [founder, executive, deptLead] = await Promise.all([
    prisma.user.findFirst({ where: { role: "super_admin", isActive: true }, select: { id: true, fullName: true, gender: true } }),
    prisma.user.findFirst({ where: { role: "executive", isActive: true }, select: { id: true, fullName: true, gender: true } }),
    m.departmentId
      ? prisma.user.findFirst({
          where: { role: "department_admin", departmentId: m.departmentId, isActive: true },
          select: { id: true, fullName: true, gender: true },
        })
      : null,
  ]);
  const sigOf = async (userId: string | undefined) =>
    userId
      ? prisma.leaderSignature.findFirst({
          where: { userId, status: "approved" },
          orderBy: { approvedAt: "desc" },
          select: { id: true },
        })
      : null;
  const [fs, es, ls] = await Promise.all([sigOf(founder?.id), sigOf(executive?.id), sigOf(deptLead?.id)]);

  const founderRef: SignerRef = {
    seat: "founder",
    userId: founder?.id ?? null,
    title: roleTitle("super_admin", founder?.gender),
    name: founder?.fullName ?? "—",
    signatureId: fs?.id ?? null,
  };
  const execRef: SignerRef = {
    seat: "executive",
    userId: executive?.id ?? null,
    title: roleTitle("executive", executive?.gender),
    name: executive?.fullName ?? "—",
    signatureId: es?.id ?? null,
  };
  const leadRef: SignerRef = {
    seat: "department_lead",
    userId: deptLead?.id ?? null,
    title: roleTitle("department_admin", deptLead?.gender, m.department?.name),
    name: deptLead?.fullName ?? "—",
    signatureId: ls?.id ?? null,
  };
  const pair: [SignerRef, SignerRef] =
    type === "leadership" || isLead || !deptLead ? [founderRef, execRef] : [leadRef, execRef];

  // توقيعاتٌ بطلت لأصحاب هذين المقعدين — تُعرض «مُبطَلة — لا تُستخدم» ولا تُستعمل
  const seatRoles = pair.map((s) => (s.seat === "department_lead" ? "department_admin" : s.seat === "founder" ? "super_admin" : "executive"));
  const superseded = await prisma.leaderSignature.findMany({
    where: {
      status: "superseded",
      role: { in: seatRoles },
      ...(seatRoles.includes("department_admin") ? { OR: [{ role: { not: "department_admin" } }, { departmentId: m.departmentId }] } : {}),
      userId: { notIn: pair.map((s) => s.userId).filter((x): x is string => !!x) },
    },
    orderBy: { supersededAt: "desc" },
    select: { id: true, role: true, user: { select: { fullName: true, gender: true } } },
    take: 3,
  });

  return {
    pair,
    superseded: superseded.map((s) => ({
      id: s.id,
      title:
        s.role === "department_admin"
          ? `${s.user.gender === "female" ? "قائدة سابقة" : "قائد سابق"} للقسم`
          : s.role === "executive"
            ? "رئيسٌ تنفيذيٌّ سابق"
            : "مؤسسٌ سابق",
      name: s.user.fullName,
    })),
  };
}

/** صورُ التوقيعات بمعرّفاتها — للمعاينة وللشهادة الصادرة */
async function signatureImages(ids: Array<string | null>): Promise<Map<string, string>> {
  const real = ids.filter((x): x is string => !!x);
  if (!real.length) return new Map();
  const rows = await prisma.leaderSignature.findMany({ where: { id: { in: real } }, select: { id: true, imageData: true } });
  return new Map(rows.filter((r) => r.imageData).map((r) => [r.id, r.imageData!]));
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "•••";
  return `${name.slice(0, 1)}•••@${domain}`;
}

/** ما يمنع هذا النوع لهذا الشخص الآن — نصّاً يُقرأ. و`null` إن لم يمنعه شيء */
function blockedReason(type: CertificateType, m: MemberRow, issuedOccasions: Set<string>): string | null {
  if (m.offboardingClosedAt || m.noFurtherEmail) return "أُغلقت تجربته — لا تُصدَر له شهادةٌ جديدة";
  if (m.approvalStatus !== "approved") return "لم يُعتمد انضمامه بعد";
  switch (type) {
    case "appreciation":
      if (m.appreciationIssuedAt || issuedOccasions.has("appreciation")) return "صدرت شهادة التقدير له سابقاً — لا تكرار";
      if (m.stepDownAt) return "بدأ ختام تجربته — تُصدَر له شهادة الشكر والخبرة";
      if (!m.isActive) return "حسابه غير نشط";
      return null;
    case "final":
      if (m.certificateIssuedAt || issuedOccasions.has("final")) return "صدرت شهادة الشكر والخبرة له سابقاً — لا تكرار";
      if (!m.stepDownAt) return "تُصدَر عند ختام التجربة وحده (بعد التنحّي)";
      if (!earnsFinalCertificate(m)) return "خرج خلال أول أسبوعين من انضمامه — لا شهادة شكر وخبرة";
      return null;
    case "membership":
      if (issuedOccasions.has("membership")) return "صدرت شهادة العضوية له سابقاً — لا تكرار";
      if (!m.isActive) return "حسابه غير نشط";
      return null;
    case "appointment":
      if (!m.isActive || m.stepDownAt) return "لا يُعيَّن من بدأ ختام تجربته أو عُطِّل حسابه";
      return null;
    default:
      if (!m.isActive && !m.stepDownAt) return "حسابه غير نشط";
      return null;
  }
}

/** كلُّ ما تحتاجه واجهةُ الإصدار عن مستلِمٍ واحد — يُقرأ عند اختياره */
export async function recipientDetails(actorRole: string, memberId: string, now = new Date()) {
  const m = await prisma.member.findUnique({ where: { id: memberId }, include: MEMBER_INCLUDE });
  if (!m) return { ok: false as const, reason: "السجل غير موجود" };
  if (!mayIssueCertificateFor(actorRole, m.invite.targetRole)) {
    return { ok: false as const, reason: "ليس في عهدتك في سلسلة الإصدار" };
  }
  const issued = await prisma.issuedCertificate.findMany({
    where: { memberId },
    select: { occasion: true, kind: true, number: true },
  });
  const occasions = new Set(issued.map((r) => r.occasion));
  const facts = factsOf(m, now);
  const code = departmentCode(m.department);
  const lastPerPrefix = await Promise.all(
    CERTIFICATE_TYPES.map(async (t) => [t, await nextNumber(prisma, numberPrefix(code, t, now))] as const)
  );
  const signersByType = Object.fromEntries(
    await Promise.all(
      (["leadership", "appreciation"] as const).map(async (t) => [t, await resolveSigners(m, t)] as const)
    )
  );
  const images = await signatureImages(
    [...signersByType.leadership.pair, ...signersByType.appreciation.pair].map((s) => s.signatureId)
  );
  const withImage = (p: [SignerRef, SignerRef]) =>
    p.map((s) => ({ ...s, signatureImage: s.signatureId ? images.get(s.signatureId) ?? null : null })) as [
      SignerRef & { signatureImage: string | null },
      SignerRef & { signatureImage: string | null },
    ];

  return {
    ok: true as const,
    recipient: {
      id: m.id,
      name: m.fullName,
      initial: m.fullName.trim().charAt(0),
      jobTitle: m.jobTitle,
      departmentName: m.department?.name ?? null,
      targetRole: m.invite.targetRole,
      isActive: m.isActive,
      stepDownAt: m.stepDownAt?.toISOString() ?? null,
      joinedAt: (m.decidedAt ?? m.joinDate).toISOString(),
      emailMasked: maskEmail(m.email),
      colorHex: m.department?.colorHex ?? BRAND.temptress,
    },
    facts,
    /** الأصلُ لكل نوع — تُقاس عليه التعديلات */
    defaults: Object.fromEntries(CERTIFICATE_TYPES.map((t) => [t, defaultFields(t, facts, now)])) as Record<
      CertificateType,
      CertificateFields
    >,
    actual: Object.fromEntries(CERTIFICATE_TYPES.map((t) => [t, actualDuration(t, facts, now)])) as Record<
      CertificateType,
      string | null
    >,
    blocked: Object.fromEntries(CERTIFICATE_TYPES.map((t) => [t, blockedReason(t, m, occasions)])) as Record<
      CertificateType,
      string | null
    >,
    issuedOccasions: [...occasions],
    nextNumbers: Object.fromEntries(lastPerPrefix) as Record<CertificateType, string>,
    signers: {
      // شهادةُ القيادة يوقّعها المؤسس والتنفيذي — وما سواها بالقاعدة العامة
      leadership: { pair: withImage(signersByType.leadership.pair), superseded: signersByType.leadership.superseded },
      other: { pair: withImage(signersByType.appreciation.pair), superseded: signersByType.appreciation.superseded },
    },
  };
}

export type RecipientDetails = Extract<Awaited<ReturnType<typeof recipientDetails>>, { ok: true }>;

/** يقصّ كلَّ حقلٍ نصّيّ ويقصره على حقول النوع — ما لا ينتمي للنوع لا يُحفظ */
function cleanFields(type: CertificateType, input: Partial<CertificateFields>): CertificateFields {
  const out: CertificateFields = { printedName: "", title: "", unit: "", sentence: "" };
  for (const spec of FIELD_SPECS[type]) {
    const raw = input[spec.key];
    const max = spec.input === "textarea" ? 400 : 120;
    let v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
    if (spec.input === "date" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = "";
    (out as Record<string, string>)[spec.key] = v;
  }
  return out;
}

export type IssueInput = {
  memberId: string;
  type: CertificateType;
  fields: Partial<CertificateFields>;
  early?: { reason: string; reference: string } | null;
};

export const EARLY_REASON_MIN = 5;
export const EARLY_REFERENCE_MIN = 2;

class Duplicate extends Error {}

function uniqueTarget(e: unknown): string | null {
  if (!e || typeof e !== "object" || (e as { code?: string }).code !== "P2002") return null;
  const t = (e as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(t) ? t.join(",") : String(t ?? "");
}

/** يُنشئ صفَّ السجل ويختم ملفَّ العضو للنوعين القديمين — في معاملةٍ واحدة.
 *  ورقمُ الشهادة يُعاد حسابُه إن سبقه إصدارٌ متزامن إلى الرقم نفسه. */
async function createRow(opts: {
  m: MemberRow;
  type: CertificateType;
  fields: CertificateFields;
  signers: [SignerRef, SignerRef];
  edits: ReturnType<typeof fieldEdits>;
  early: { reason: string; reference: string } | null;
  issuedById: string | null;
  issuedByName: string;
  at: Date;
  /** الختمُ موجودٌ سلفاً (بابٌ آليٌّ ختم ثم سجّل) — فلا يُختم ثانيةً */
  stampAlreadyDone?: boolean;
}) {
  const { m, type, fields, at } = opts;
  const snapshot: Snapshot = {
    v: 1,
    type,
    colorHex: m.department?.colorHex ?? BRAND.temptress,
    departmentName: m.department?.name ?? null,
    fields,
    signers: opts.signers,
  };
  const prefix = numberPrefix(departmentCode(m.department), type, at);
  const occasion = occasionFor(type, fields);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (!opts.stampAlreadyDone && type === "appreciation") {
          const start = m.decidedAt ?? m.joinDate;
          const stamped = await tx.member.updateMany({
            where: { id: m.id, appreciationIssuedAt: null },
            data: { appreciationIssuedAt: at, appreciationDueAt: opts.early ? at : anniversaryDate(start, 3) },
          });
          if (stamped.count === 0) throw new Duplicate();
        }
        if (!opts.stampAlreadyDone && type === "final") {
          const stamped = await tx.member.updateMany({
            where: { id: m.id, certificateIssuedAt: null },
            data: { certificateIssuedAt: at },
          });
          if (stamped.count === 0) throw new Duplicate();
        }
        const number = await nextNumber(tx, prefix, attempt);
        return tx.issuedCertificate.create({
          data: {
            number,
            kind: type,
            occasion,
            memberId: m.id,
            data: snapshot as unknown as Prisma.InputJsonValue,
            edits: opts.edits.length ? (opts.edits as unknown as Prisma.InputJsonValue) : undefined,
            early: !!opts.early,
            earlyReason: opts.early?.reason ?? null,
            earlyReference: opts.early?.reference ?? null,
            issuedById: opts.issuedById,
            issuedByName: opts.issuedByName,
            issuedAt: at,
          },
        });
      });
    } catch (e) {
      if (e instanceof Duplicate) return null;
      const target = uniqueTarget(e);
      if (target === null) throw e;
      if (target.includes("number")) continue; // سبقه رقمٌ متزامن — يُعاد بالتالي
      return null; // (memberId, occasion): صدرت لهذه المناسبة للتوّ
    }
  }
  throw new Error("تعذّر تخصيص رقمٍ للشهادة — أعد المحاولة");
}

/** يُرسل الشهادة ببريد نوعها، ويختم وصولها في السجل وملف العضو */
async function deliver(certificateId: string, byName: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = await prisma.issuedCertificate.findUnique({
    where: { id: certificateId },
    include: { member: { include: MEMBER_INCLUDE } },
  });
  if (!row) return { ok: false, reason: "الشهادة غير موجودة" };
  if (row.sentAt) return { ok: true };
  const snap = row.data as unknown as Snapshot;
  const m = row.member;
  const url = registryCertificateUrl(row.id, appBaseUrl());
  const email = await import("@/lib/email");
  const sent =
    snap.type === "appreciation"
      ? await email.sendAppreciationEmail({
          to: m.email,
          fullName: m.fullName,
          jobTitle: snap.fields.title || m.jobTitle,
          departmentName: snap.departmentName,
          certificateUrl: url,
          fullTerm: !row.early,
        })
      : snap.type === "final"
        ? await email.sendCertificateEmail({
            to: m.email,
            fullName: m.fullName,
            departmentName: snap.departmentName,
            mission: m.jobTitle,
            period:
              snap.fields.periodStart && snap.fields.periodEnd
                ? { start: new Date(`${snap.fields.periodStart}T12:00:00Z`), end: new Date(`${snap.fields.periodEnd}T12:00:00Z`) }
                : null,
            certificateUrl: url,
          })
        : await email.sendIssuedCertificateEmail({
            to: m.email,
            fullName: m.fullName,
            heading: TYPE_INFO[snap.type].heading.ar,
            sentence: snap.fields.sentence,
            number: row.number,
            departmentName: snap.departmentName,
            certificateUrl: url,
          });

  if (sent.skipped) return { ok: false, reason: "صدرت الشهادة ولم يصل بريدها — أعد الإرسال من السجل" };

  const at = new Date();
  await prisma.issuedCertificate.update({ where: { id: row.id }, data: { sentAt: at } });
  if (snap.type === "appreciation") {
    await prisma.member.updateMany({ where: { id: m.id, appreciationSentAt: null }, data: { appreciationSentAt: at } });
  }
  if (snap.type === "final") {
    await prisma.member.updateMany({ where: { id: m.id, certificateSentAt: null }, data: { certificateSentAt: at } });
  }
  await appendMemberEvent({
    fullName: m.fullName,
    email: m.email,
    event: `تسليم ${TYPE_INFO[snap.type].heading.ar}`,
    roleOrDepartment: snap.departmentName ?? m.jobTitle ?? "—",
    details: `رقم ${row.number} — وصلت برابطها الموقَّع — سلّمها ${byName}`,
    at,
  });
  const { syncMemberLifecycleRow } = await import("@/lib/workflow");
  await syncMemberLifecycleRow(m.id);
  return { ok: true };
}

/** **الإصدار اليدوي** من «الترحيب والتكريم» — يُفحص كلُّ شيءٍ هنا ثانيةً في الخادم:
 *  السلسلة، والأهلية، والحقول، والإصدار المبكر بسببه ومرجعه، ولا تكرار. */
export async function issueCertificate(
  actor: IssueActor,
  input: IssueInput
): Promise<{ ok: true; id: string; number: string; delivered: boolean; reason?: string } | { ok: false; reason: string }> {
  if (!CERTIFICATE_TYPES.includes(input.type)) return { ok: false, reason: "نوع الشهادة غير معروف" };
  const m = await prisma.member.findUnique({ where: { id: input.memberId }, include: MEMBER_INCLUDE });
  if (!m) return { ok: false, reason: "السجل غير موجود" };
  if (!mayIssueCertificateFor(actor.role, m.invite.targetRole)) {
    return { ok: false, reason: "ليس في عهدتك في سلسلة الإصدار" };
  }
  const existing = await prisma.issuedCertificate.findMany({ where: { memberId: m.id }, select: { occasion: true } });
  const blocked = blockedReason(input.type, m, new Set(existing.map((r) => r.occasion)));
  if (blocked) return { ok: false, reason: blocked };

  const fields = cleanFields(input.type, input.fields);
  const missing = missingFields(input.type, fields);
  if (missing.length) return { ok: false, reason: `أكمل: ${missing.join("، ")}` };
  if (existing.some((r) => r.occasion === occasionFor(input.type, fields))) {
    return { ok: false, reason: "صدرت له شهادةٌ لهذه المناسبة سابقاً — لا تكرار" };
  }

  // **الإصدار المبكر:** تقديرُ الثلاثة أشهر قبل اكتمالها — بقرارٍ إداريٍّ له سببٌ ومرجع
  const facts = factsOf(m);
  let early: { reason: string; reference: string } | null = null;
  if (input.type === "appreciation" && !facts.completedThreeMonths) {
    const reason = input.early?.reason?.replace(/\s+/g, " ").trim().slice(0, 300) ?? "";
    const reference = input.early?.reference?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
    if (!input.early) return { ok: false, reason: "لم يُكمل ثلاثة أشهر — الإصدار قبلها قرارٌ إداريّ مبكر" };
    if (reason.length < EARLY_REASON_MIN) return { ok: false, reason: "اكتب سبب القرار الإداري" };
    if (reference.length < EARLY_REFERENCE_MIN) return { ok: false, reason: "اكتب مرجع القرار" };
    early = { reason, reference };
  }

  const at = new Date();
  const defaults = defaultFields(input.type, facts, at);
  const edits = fieldEdits(input.type, defaults, fields, m.gender, at);
  const { pair } = await resolveSigners(m, input.type);
  const row = await createRow({
    m,
    type: input.type,
    fields,
    signers: pair,
    edits,
    early,
    issuedById: actor.id,
    issuedByName: actor.name,
    at,
  });
  if (!row) return { ok: false, reason: "صدرت له شهادةٌ لهذه المناسبة سابقاً — لا تكرار" };

  // من أصدرها ومتى ولمن وبأي رقم — يُسجَّل عند الإصدار ولو تعذّر البريد بعده
  const actual = actualDuration(input.type, facts, at);
  const durationEdited = edits.find((e) => e.field === FIELD_SPECS[input.type].find((s) => s.key === "duration")?.label);
  const missingSig = pair.filter((s) => !s.signatureId).map((s) => s.title);
  await appendMemberEvent({
    fullName: m.fullName,
    email: m.email,
    event: `إصدار ${TYPE_INFO[input.type].heading.ar}${early ? " (مبكر)" : ""}`,
    roleOrDepartment: m.department?.name ?? m.jobTitle ?? "—",
    details: [
      `رقم ${row.number} — أصدرها ${actor.name}`,
      early ? `قرارٌ إداريّ مبكر: «${early.reason}» — المرجع: ${early.reference}` : null,
      durationEdited && actual ? `المدة عُدِّلت يدوياً إلى «${durationEdited.to}» — الفعلية ${actual}` : null,
      edits.length ? `تعديلات يدوية: ${edits.map((e) => e.field).join("، ")}` : null,
      missingSig.length ? `بلا توقيع معتمد لـ: ${missingSig.join("، ")}` : null,
    ]
      .filter(Boolean)
      .join(" — "),
    at,
  });

  const sent = await deliver(row.id, actor.name);
  return sent.ok
    ? { ok: true, id: row.id, number: row.number, delivered: true }
    : { ok: true, id: row.id, number: row.number, delivered: false, reason: sent.reason };
}

/** إعادةُ إرسال شهادةٍ صدرت ولم يصل بريدها — بالسلسلة نفسها، بلا شهادةٍ ثانية */
export async function resendIssued(actor: IssueActor, certificateId: string) {
  const row = await prisma.issuedCertificate.findUnique({
    where: { id: certificateId },
    select: { id: true, sentAt: true, member: { select: { invite: { select: { targetRole: true } } } } },
  });
  if (!row) return { ok: false as const, reason: "الشهادة غير موجودة" };
  if (!mayIssueCertificateFor(actor.role, row.member.invite.targetRole)) {
    return { ok: false as const, reason: "ليس في عهدتك في سلسلة الإصدار" };
  }
  if (row.sentAt) return { ok: true as const };
  return deliver(row.id, actor.name);
}

/** **الأبواب الآلية** — كنسُ الثلاثة أشهر وختامُ التجربة يختمان ملفَّ العضو بأنفسهما،
 *  ثم يُسجَّل هنا صفُّها برقمٍ ولقطة. يُرجع رابطَ السجل لتُرسَل به الشهادة؛ و`null`
 *  إن تعذّر التسجيل (فيبقى الرابطُ القديم بمعرّف العضو صالحاً). */
export async function registerAutomatic(
  memberId: string,
  type: "appreciation" | "final",
  byName: string
): Promise<{ id: string; url: string } | null> {
  const existing = await prisma.issuedCertificate.findUnique({
    where: { memberId_occasion: { memberId, occasion: type } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, url: registryCertificateUrl(existing.id, appBaseUrl()) };
  const m = await prisma.member.findUnique({ where: { id: memberId }, include: MEMBER_INCLUDE });
  if (!m) return null;
  const at = (type === "appreciation" ? m.appreciationIssuedAt : m.certificateIssuedAt) ?? new Date();
  const facts = factsOf(m, at);
  // المدّةُ حتى يوم الختم أو يوم الاستحقاق إن سبقه — من كُرِّم متأخّراً تبقى «٣ أشهر»
  const fields = defaultFields(type, facts, at);
  const { pair } = await resolveSigners(m, type);
  try {
    const row = await createRow({
      m,
      type,
      fields,
      signers: pair,
      edits: [],
      early: null,
      issuedById: null,
      issuedByName: byName,
      at,
      stampAlreadyDone: true,
    });
    if (!row) {
      const again = await prisma.issuedCertificate.findUnique({
        where: { memberId_occasion: { memberId, occasion: type } },
        select: { id: true },
      });
      return again ? { id: again.id, url: registryCertificateUrl(again.id, appBaseUrl()) } : null;
    }
    return { id: row.id, url: registryCertificateUrl(row.id, appBaseUrl()) };
  } catch (e) {
    console.error("[certificateRegistry] registerAutomatic", e);
    return null;
  }
}

/** يختم وصول الشهادة الآلية في صفّها — يُنادى بعد نجاح البريد في البابين الآليين */
export async function markRegistrySent(certificateId: string, at = new Date()) {
  await prisma.issuedCertificate.updateMany({ where: { id: certificateId, sentAt: null }, data: { sentAt: at } });
}

/** الشهادةُ الصادرة كما تُرسم — من لقطتها، بتوقيعَيها المعتمدين يوم صدورها */
export async function issuedCertificateView(id: string): Promise<CertificateView | null> {
  const row = await prisma.issuedCertificate.findUnique({ where: { id } });
  if (!row) return null;
  const snap = row.data as unknown as Snapshot;
  if (!snap || snap.v !== 1 || !CERTIFICATE_TYPES.includes(snap.type)) return null;
  const images = await signatureImages(snap.signers.map((s) => s.signatureId));
  const signers = snap.signers.map((s) => ({
    title: s.title,
    name: s.name,
    signatureImage: s.signatureId ? images.get(s.signatureId) ?? null : null,
  })) as CertificateView["signers"];
  return buildView(snap.type, snap.fields, {
    colorHex: snap.colorHex,
    number: row.number,
    issuedAt: row.issuedAt.toISOString(),
    signers,
  });
}

/** سجلُّ الشهادات الصادرة — لمن في عهدة صاحب الدور وحدهم، الأحدث أولاً */
export async function listIssued(targets: InviteTargetRole[], q: string, take = 30) {
  const rows = await prisma.issuedCertificate.findMany({
    where: {
      member: {
        invite: { targetRole: { in: targets } },
        ...(q ? { fullName: { contains: q, mode: "insensitive" as const } } : {}),
      },
    },
    orderBy: { issuedAt: "desc" },
    take,
    select: {
      id: true,
      number: true,
      kind: true,
      early: true,
      earlyReason: true,
      earlyReference: true,
      edits: true,
      issuedById: true,
      issuedByName: true,
      issuedAt: true,
      sentAt: true,
      member: { select: { fullName: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    type: (CERTIFICATE_TYPES as string[]).includes(r.kind) ? (r.kind as CertificateType) : null,
    url: registryCertificateUrl(r.id, ""),
    editsCount: Array.isArray(r.edits) ? r.edits.length : 0,
  }));
}
