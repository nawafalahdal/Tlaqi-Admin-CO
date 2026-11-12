import { createHash, randomInt } from "node:crypto";
import type { AgreementKind, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { recordOrgEvent } from "@/lib/org/audit";
import { appBaseUrl } from "@/lib/emailBrand";
import { seniorContext } from "./senior";
import { AGREEMENT_ASSETS, AGREEMENT_KIND_LABEL } from "./agreementTexts";

/** **اتفاقياتُ السرية (التسويق والتقنية) — جزءٌ من الحوكمة لا نظامٌ منفصل.**
 *
 *  - **الإصدارات:** لكل نوعٍ إصدارٌ سارٍ واحد (قيدٌ في القاعدة). المسودّةُ تُعدَّل، والمنشورُ مجمَّدٌ نصُّه وبصمتُه
 *    (`AgreementTemplate_frozen`)؛ ونشرُ إصدارٍ جديد يُقاعد السابق، فيصير من وقّع القديم «يحتاج تحديثاً».
 *  - **التوقيع:** بعد قراءة النص كاملاً، باسمٍ مكتوبٍ يطابق اسمَ الحساب، ورمزٍ لمرّةٍ واحدة إلى بريد الحساب
 *    نفسه، وزرّ «أوافق على الاتفاقية وأوقع إلكترونيًا». ولا تُجمع الهويةُ الوطنية ولا صورتها.
 *  - **الإثبات:** بصمةُ الوثيقة (SHA-256 لنصّها) + بصمةُ سجلّ الإثبات كلّه، مسلسلةً بالتوقيع الذي قبله؛ والتوقيعُ
 *    لا يُعدَّل ولا يُحذف (`APPEND_ONLY`)؛ والنسخةُ الموقّعة تُعاد بناؤها من بياناتٍ ثابتة وتُتحقَّق بصماتُها.
 *  - **الوصول:** لا وصولَ حساساً قبل التوقيع على الإصدار السارى (`agreementPending` في وكيل التسويق، ومنحُ الأصول
 *    التقنية والتسويقية لا يقع بلا توقيع). وعند الإنهاء أو التعطيل يُسحب الوصولُ ويُسجَّل وتبقى الاتفاقية.
 *  - **البلاغات:** مراجعةٌ بشرية بحالاتها، ولا حكمَ آلي. وكلُّ إجراءٍ في سجل الحوكمة (`scope: "agreement"`). */

type Db = Prisma.TransactionClient | typeof prisma;
type Ok<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };
const fail = (reason: string) => ({ ok: false as const, reason });
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const documentHashOf = (body: string) => sha256(body);

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_HOUR = 5;
const EVENT_DEPT = "platform";
export const SIGN_METHOD = "typed-name+email-otp";

export type Subject = { kind: "user" | "member"; id: string };
const subjectKey = (s: Subject) => `${s.kind}:${s.id}`;

export type AgreementStatus = "not_sent" | "pending" | "signed" | "needs_update" | "ended" | "cancelled";
export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  not_sent: "لم تُرسل",
  pending: "بانتظار التوقيع",
  signed: "موقعة",
  needs_update: "تحتاج تحديثًا",
  ended: "منتهية",
  cancelled: "ملغاة",
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "المؤسس",
  executive: "الرئيس التنفيذي",
  operations_officer: "مسؤول التشغيل",
  department_admin: "قائد قسم",
  member: "عضو",
};

/** المُصدِرون لا يوقّعون: المؤسسُ والرئيسُ التنفيذي يمثّلان المنصة */
const ISSUER_ROLES = new Set(["super_admin", "executive"]);

export type AgreementContext = {
  account: { kind: "user" | "member"; id: string; name: string; email: string; role: string; roleLabel: string } | null;
  canView: boolean;
  canManage: boolean;
};

/** صاحبُ الطلب — من القاعدة (حسابٌ نشط) وصلاحيتُه من الإدارة العليا */
export async function agreementContext(session: Session | null): Promise<AgreementContext> {
  const s = await seniorContext(session);
  if (!s.account) return { account: null, canView: false, canManage: false };
  let roleLabel = ROLE_LABEL[s.account.role] ?? s.account.role;
  if (s.position) roleLabel = `${roleLabel} — ${s.position.titleAr}`;
  return {
    account: { ...s.account, roleLabel },
    canView: s.capabilities.has("agreements_view") || s.capabilities.has("agreements_manage"),
    canManage: s.capabilities.has("agreements_manage"),
  };
}

async function audit(db: Db, ctx: AgreementContext | null, entityId: string, action: string, extra: { before?: Prisma.InputJsonValue | null; after?: Prisma.InputJsonValue | null; note?: string | null; result?: "success" | "denied" } = {}) {
  await recordOrgEvent(db, {
    scope: "agreement",
    entityId,
    departmentId: EVENT_DEPT,
    action,
    actor: ctx?.account
      ? { kind: ctx.account.kind, id: ctx.account.id, name: ctx.account.name, role: ctx.account.role }
      : { kind: "system", id: "system", name: "المنصة — آلياً", role: "system" },
    ...extra,
  });
}

/** **إدارةُ الاتفاقيات:** لمن له «الاتفاقيات (إدارة)» — والمحاولةُ المرفوضة تُسجَّل */
async function requireAgreementsManager(ctx: AgreementContext, action: string, entityId: string) {
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (!ctx.canManage) {
    await audit(prisma, ctx, entityId, action, { result: "denied", note: "لا صلاحيةَ لإدارة الاتفاقيات" }).catch(() => {});
    return fail("إدارةُ الاتفاقيات لمن له صلاحيتُها");
  }
  return null;
}

// ═════════════════════════ الإصدارات ═════════════════════════

export async function activeTemplate(kind: AgreementKind, db: Db = prisma) {
  return db.agreementTemplate.findFirst({ where: { kind, status: "active" } });
}

function cleanBody(v: unknown) {
  return String(v ?? "").replace(/\r/g, "").trim().slice(0, 40_000);
}

export async function createDraftTemplate(ctx: AgreementContext, input: { kind: AgreementKind; titleAr: unknown; titleEn?: unknown; body: unknown; changeNote?: unknown }): Promise<Ok<{ id: string; version: number }>> {
  const blocked = await requireAgreementsManager(ctx, "agreement.template.draft", input.kind);
  if (blocked) return blocked;
  if (input.kind !== "marketing" && input.kind !== "technical") return fail("نوعٌ غير معروف");
  const titleAr = String(input.titleAr ?? "").trim().slice(0, 160);
  const body = cleanBody(input.body);
  if (titleAr.length < 4) return fail("اكتب عنوان الاتفاقية");
  if (body.length < 200) return fail("نصُّ الاتفاقية قصيرٌ جداً");
  const existingDraft = await prisma.agreementTemplate.findFirst({ where: { kind: input.kind, status: "draft" }, select: { id: true } });
  if (existingDraft) return fail("لهذا النوع مسودّةٌ قائمة — عدّلها أو انشرها");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tlaqi:agreement-version:${input.kind}`}))`;
      const last = await tx.agreementTemplate.findFirst({ where: { kind: input.kind }, orderBy: { version: "desc" }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      const t = await tx.agreementTemplate.create({
        data: {
          kind: input.kind, version, titleAr, titleEn: String(input.titleEn ?? "").trim().slice(0, 160) || null,
          issuer: "منصة TLAQI", body, bodyHash: documentHashOf(body), changeNote: String(input.changeNote ?? "").trim().slice(0, 600) || null,
          createdByName: ctx.account!.name,
        },
        select: { id: true, version: true },
      });
      await audit(tx, ctx, t.id, "agreement.template.draft", { after: { kind: input.kind, version, bodyHash: documentHashOf(body) } });
      return { ok: true as const, id: t.id, version: t.version };
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return fail("تعارضٌ في رقم الإصدار — أعد المحاولة");
    throw e;
  }
}

export async function updateDraftTemplate(ctx: AgreementContext, id: string, input: { titleAr: unknown; titleEn?: unknown; body: unknown; changeNote?: unknown }): Promise<Ok> {
  const blocked = await requireAgreementsManager(ctx, "agreement.template.edit", id);
  if (blocked) return blocked;
  const t = await prisma.agreementTemplate.findUnique({ where: { id }, select: { status: true, bodyHash: true } });
  if (!t) return fail("الإصدار غير موجود");
  if (t.status !== "draft") return fail("الإصدارُ المنشور ثابت — أنشئ إصداراً جديداً");
  const body = cleanBody(input.body);
  const titleAr = String(input.titleAr ?? "").trim().slice(0, 160);
  if (titleAr.length < 4 || body.length < 200) return fail("العنوان والنص مطلوبان");
  const w = await prisma.agreementTemplate.updateMany({
    where: { id, status: "draft" },
    data: { titleAr, titleEn: String(input.titleEn ?? "").trim().slice(0, 160) || null, body, bodyHash: documentHashOf(body), changeNote: String(input.changeNote ?? "").trim().slice(0, 600) || null },
  });
  if (!w.count) return fail("نُشر الإصدار للتوّ — حدّث الصفحة");
  await audit(prisma, ctx, id, "agreement.template.edit", { before: { bodyHash: t.bodyHash }, after: { bodyHash: documentHashOf(body) } });
  return { ok: true };
}

/** **نشرُ إصدار** — يُقاعد السابق (من وقّعه «يحتاج تحديثاً» ويُطلب منه التوقيع على الجديد) */
export async function publishTemplate(ctx: AgreementContext, id: string, rawNote: unknown): Promise<Ok<{ version: number }>> {
  const blocked = await requireAgreementsManager(ctx, "agreement.template.publish", id);
  if (blocked) return blocked;
  const note = String(rawNote ?? "").trim().slice(0, 600);
  if (note.length < 3) return fail("اكتب ما تغيّر في هذا الإصدار");
  const t = await prisma.agreementTemplate.findUnique({ where: { id } });
  if (!t) return fail("الإصدار غير موجود");
  if (t.status !== "draft") return fail("نُشر هذا الإصدار من قبل");
  if (documentHashOf(t.body) !== t.bodyHash) return fail("بصمةُ النص لا تطابقه — احفظ المسودّة ثانيةً");
  const res = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tlaqi:agreement-version:${t.kind}`}))`;
    const prev = await tx.agreementTemplate.findFirst({ where: { kind: t.kind, status: "active" }, select: { id: true, version: true } });
    if (prev) await tx.agreementTemplate.update({ where: { id: prev.id }, data: { status: "retired", retiredAt: new Date() } });
    const w = await tx.agreementTemplate.updateMany({
      where: { id, status: "draft" },
      data: { status: "active", publishedAt: new Date(), publishedByName: ctx.account!.name, changeNote: note },
    });
    if (!w.count) throw new Error("RACE");
    await audit(tx, ctx, id, "agreement.template.publish", {
      before: { activeVersion: prev?.version ?? null },
      after: { kind: t.kind, version: t.version, bodyHash: t.bodyHash },
      note,
    });
    return t.version;
  }).catch((e) => (String(e).includes("RACE") ? null : Promise.reject(e)));
  if (res === null) return fail("نُشر الإصدار للتوّ — حدّث الصفحة");
  return { ok: true, version: res };
}

// ═════════════════════════ الحالة ═════════════════════════

/** **حالةُ شخصٍ مع نوع اتفاقية** — من طلب التوقيع والتوقيعات والإصدار السارى */
export async function statusOf(subject: Subject, kind: AgreementKind, db: Db = prisma): Promise<{ status: AgreementStatus; signatureId: string | null; signedVersion: number | null; activeVersion: number | null }> {
  const [active, req, sigs] = await Promise.all([
    activeTemplate(kind, db),
    db.agreementRequirement.findUnique({ where: { kind_subjectKind_subjectId: { kind, subjectKind: subject.kind, subjectId: subject.id } } }),
    db.agreementSignature.findMany({ where: { kind, signerKind: subject.kind, signerId: subject.id }, orderBy: { version: "desc" }, select: { id: true, version: true, templateId: true } }),
  ]);
  const onActive = active ? sigs.find((s) => s.templateId === active.id) : null;
  const latest = sigs[0] ?? null;
  const base = { signedVersion: latest?.version ?? null, activeVersion: active?.version ?? null };
  if (req?.cancelledAt) return { status: "cancelled", signatureId: latest?.id ?? null, ...base };
  if (req?.endedAt) return { status: "ended", signatureId: latest?.id ?? null, ...base };
  if (onActive) return { status: "signed", signatureId: onActive.id, ...base };
  if (latest) return { status: "needs_update", signatureId: latest.id, ...base };
  if (req?.sentAt) return { status: "pending", signatureId: null, ...base };
  return { status: "not_sent", signatureId: null, ...base };
}

/** **بوابةُ الوصول الحساس:** هل يلزمه توقيعٌ قبل الدخول؟ — حين يوجد إصدارٌ سارٍ ولم يوقّعه، ولم يكن من المُصدِرين.
 *  وبلا إصدارٍ سارٍ لا بوابة (قبل أن تنشر الإدارةُ الاتفاقية يبقى الوصولُ كما كان — قرارٌ موثَّق). */
export async function agreementPending(subject: Subject, role: string | null, kind: AgreementKind, db: Db = prisma): Promise<boolean> {
  if (role && ISSUER_ROLES.has(role)) return false;
  const active = await activeTemplate(kind, db);
  if (!active) return false;
  const signed = await db.agreementSignature.findFirst({ where: { templateId: active.id, signerKind: subject.kind, signerId: subject.id }, select: { id: true } });
  return !signed;
}

// ═════════════════════════ طلبُ التوقيع ═════════════════════════

async function subjectAccount(subject: Subject) {
  if (subject.kind === "user") {
    const u = await prisma.user.findUnique({ where: { id: subject.id }, select: { id: true, fullName: true, email: true, isActive: true, role: true } });
    return u && u.isActive ? { name: u.fullName, email: u.email, role: u.role } : null;
  }
  const m = await prisma.member.findUnique({ where: { id: subject.id }, select: { fullName: true, email: true, isActive: true, terminatedAt: true, approvalStatus: true } });
  return m && m.isActive && !m.terminatedAt ? { name: m.fullName, email: m.email, role: "member" } : null;
}

/** الحسابُ بالبريد — للطلب من لوحة الإدارة */
export async function subjectByEmail(email: string): Promise<Subject | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const u = await prisma.user.findFirst({ where: { email: { equals: e, mode: "insensitive" }, isActive: true }, select: { id: true } });
  if (u) return { kind: "user", id: u.id };
  const m = await prisma.member.findFirst({ where: { email: { equals: e, mode: "insensitive" }, isActive: true, terminatedAt: null }, select: { id: true } });
  return m ? { kind: "member", id: m.id } : null;
}

/** يضمن صفَّ «مطلوبٌ توقيعُه» — آمنٌ للتكرار، ولا يُعيد ملغاةً أو منتهية إلا بقرارٍ صريح (`requestSignature`) */
export async function ensureRequirement(subject: Subject, kind: AgreementKind, reason: string, byName: string) {
  const acc = await subjectAccount(subject);
  if (!acc) return null;
  return prisma.agreementRequirement.upsert({
    where: { kind_subjectKind_subjectId: { kind, subjectKind: subject.kind, subjectId: subject.id } },
    create: { kind, subjectKind: subject.kind, subjectId: subject.id, subjectName: acc.name, subjectEmail: acc.email, reason, requiredByName: byName },
    update: {},
  });
}

/** **طلبُ التوقيع أو إعادتُه** — بريدٌ برابط القراءة والتوقيع، ويُسجَّل */
export async function requestSignature(ctx: AgreementContext, subject: Subject, kind: AgreementKind, rawReason: unknown): Promise<Ok<{ delivered: boolean }>> {
  const blocked = await requireAgreementsManager(ctx, "agreement.request", subjectKey(subject));
  if (blocked) return blocked;
  const acc = await subjectAccount(subject);
  if (!acc) return fail("الحساب غير موجود أو غير نشط");
  if (ISSUER_ROLES.has(acc.role)) return fail("المؤسسُ والرئيسُ التنفيذي يمثّلان المنصة — لا يوقّعان بصفتهما مستلمين");
  const active = await activeTemplate(kind);
  if (!active) return fail("لا إصدارَ سارياً لهذه الاتفاقية — انشر إصداراً أولاً");
  const reason = String(rawReason ?? "").trim().slice(0, 300) || (kind === "marketing" ? "الوصول إلى أصول التسويق" : "الوصول إلى الأصول التقنية");
  const now = new Date();
  const req = await prisma.agreementRequirement.upsert({
    where: { kind_subjectKind_subjectId: { kind, subjectKind: subject.kind, subjectId: subject.id } },
    create: { kind, subjectKind: subject.kind, subjectId: subject.id, subjectName: acc.name, subjectEmail: acc.email, reason, requiredByName: ctx.account!.name, sentAt: now },
    update: { reason, sentAt: now, subjectName: acc.name, subjectEmail: acc.email, cancelledAt: null, cancelledByName: null, cancelReason: null, endedAt: null, endReason: null },
  });
  const { sendAgreementRequestEmail } = await import("@/lib/email");
  const mail = await sendAgreementRequestEmail({ to: acc.email, fullName: acc.name, agreementTitle: active.titleAr, signUrl: `${appBaseUrl()}/agreements/${kind}` });
  const st = await statusOf(subject, kind);
  await audit(prisma, ctx, req.id, st.status === "needs_update" ? "agreement.resign.request" : "agreement.request", {
    after: { kind, subject: acc.name, version: active.version, status: st.status },
    note: reason,
  });
  return { ok: true, delivered: !mail.skipped };
}

export async function cancelRequirement(ctx: AgreementContext, requirementId: string, rawReason: unknown): Promise<Ok> {
  const blocked = await requireAgreementsManager(ctx, "agreement.request.cancel", requirementId);
  if (blocked) return blocked;
  const reason = String(rawReason ?? "").trim().slice(0, 300);
  if (reason.length < 3) return fail("اكتب سبب الإلغاء");
  const w = await prisma.agreementRequirement.updateMany({
    where: { id: requirementId, cancelledAt: null, endedAt: null },
    data: { cancelledAt: new Date(), cancelledByName: ctx.account!.name, cancelReason: reason },
  });
  if (!w.count) return fail("الطلبُ ملغى أو منتهٍ");
  await audit(prisma, ctx, requirementId, "agreement.request.cancel", { note: reason });
  return { ok: true };
}

// ═════════════════════════ التوقيع ═════════════════════════

/** **رمزُ التحقّق** — إلى بريد الحساب نفسه؛ عشرُ دقائق، وخمسُ محاولات، وخمسةُ رموزٍ في الساعة */
export async function requestSigningOtp(ctx: AgreementContext, kind: AgreementKind): Promise<Ok<{ delivered: boolean }>> {
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (ISSUER_ROLES.has(ctx.account.role)) return fail("المؤسسُ والرئيسُ التنفيذي يمثّلان المنصة — لا يوقّعان بصفتهما مستلمين");
  const t = await activeTemplate(kind);
  if (!t) return fail("لا إصدارَ سارياً لهذه الاتفاقية");
  const who = { signerKind: ctx.account.kind, signerId: ctx.account.id, templateId: t.id };
  const recent = await prisma.agreementOtp.findMany({ where: { ...who, createdAt: { gt: new Date(Date.now() - 3600_000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (recent.length >= OTP_PER_HOUR) return fail("طلبتَ رموزاً كثيرة — أعد المحاولة بعد ساعة");
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 60_000) return fail("انتظر دقيقةً قبل طلب رمزٍ جديد");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.$transaction([
    // رمزٌ واحدٌ صالح: الجديدُ يُبطل ما قبله
    prisma.agreementOtp.updateMany({ where: { ...who, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.agreementOtp.create({ data: { ...who, codeHash: sha256(`${t.id}:${ctx.account.id}:${code}`), expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000) } }),
  ]);
  const { sendAgreementOtpEmail } = await import("@/lib/email");
  const mail = await sendAgreementOtpEmail({ to: ctx.account.email, fullName: ctx.account.name, agreementTitle: t.titleAr, code, minutesValid: OTP_MINUTES });
  // محلياً بلا بريد: في سجلّ الخادم وحده (لا في الواجهة) — كرمز الدخول
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL && mail.skipped) console.warn(`[dev] رمز توقيع الاتفاقية ${ctx.account.email}: ${code}`);
  return { ok: true, delivered: !mail.skipped };
}

const normName = (s: string) =>
  s.normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();

function evidencePayload(x: {
  templateId: string; kind: string; version: number; documentHash: string; signerKind: string; signerId: string;
  signerAccountName: string; signerEmail: string; typedName: string; roleLabel: string; signedAt: Date; method: string;
  otpVerifiedAt: Date; userAgent: string | null; prevEvidenceHash: string | null;
}) {
  return JSON.stringify([
    x.templateId, x.kind, x.version, x.documentHash, x.signerKind, x.signerId, x.signerAccountName, x.signerEmail, x.typedName,
    x.roleLabel, x.signedAt.toISOString(), x.method, x.otpVerifiedAt.toISOString(), x.userAgent ?? "", x.prevEvidenceHash ?? "",
  ]);
}

/** **التوقيع** — كلُّ الشروط تُفحص في الخادم: إصدارٌ سارٍ (والنصُّ الذي قُرئ هو هو)، وقراءةٌ مؤكدة، واسمٌ يطابق
 *  الحساب، ورمزٌ صالح، وموافقةٌ صريحة. ثم يُكتب التوقيعُ بسلسلة بصماته — مرّةً واحدة لكل إصدار. */
export async function signAgreement(
  ctx: AgreementContext,
  input: { kind: AgreementKind; templateId: string; documentHash: string; typedName: unknown; otp: unknown; readAll: boolean; consent: boolean; userAgent?: string | null }
): Promise<Ok<{ signatureId: string }>> {
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (ISSUER_ROLES.has(ctx.account.role)) return fail("المؤسسُ والرئيسُ التنفيذي يمثّلان المنصة — لا يوقّعان بصفتهما مستلمين");
  const t = await activeTemplate(input.kind);
  if (!t || t.id !== input.templateId) return fail("صدر إصدارٌ أحدث من الاتفاقية — اقرأه ثم وقّع");
  if (input.documentHash !== t.bodyHash || documentHashOf(t.body) !== t.bodyHash) return fail("النصُّ الذي قرأته لا يطابق الإصدار السارى — حدّث الصفحة");
  if (!input.readAll) return fail("أكّد أنك قرأت نصَّ الاتفاقية كاملاً");
  if (!input.consent) return fail("الموافقةُ الصريحة مطلوبة للتوقيع");
  const typedName = String(input.typedName ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (normName(typedName) !== normName(ctx.account.name)) return fail("اكتب اسمك الكامل كما هو في حسابك");
  const code = String(input.otp ?? "").replace(/\D/g, "");
  if (code.length !== 6) return fail("اكتب رمز التحقّق المكوّن من ستة أرقام");
  const who = { signerKind: ctx.account.kind, signerId: ctx.account.id, templateId: t.id };
  const acc = ctx.account;

  try {
    const sig = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tlaqi:agreement-signatures'))`;
      const otp = await tx.agreementOtp.findFirst({ where: { ...who, usedAt: null }, orderBy: { createdAt: "desc" } });
      if (!otp || otp.expiresAt < new Date()) throw new Error("OTP_EXPIRED");
      if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new Error("OTP_LOCKED");
      if (otp.codeHash !== sha256(`${t.id}:${acc.id}:${code}`)) {
        await tx.agreementOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        return { wrong: true as const };
      }
      const otpVerifiedAt = new Date();
      await tx.agreementOtp.update({ where: { id: otp.id }, data: { usedAt: otpVerifiedAt } });
      const prev = await tx.agreementSignature.findFirst({ orderBy: [{ signedAt: "desc" }, { id: "desc" }], select: { evidenceHash: true } });
      const row = {
        templateId: t.id, kind: t.kind, version: t.version, documentHash: t.bodyHash, signerKind: acc.kind, signerId: acc.id,
        signerAccountName: acc.name, signerEmail: acc.email, typedName, roleLabel: acc.roleLabel, signedAt: new Date(),
        method: SIGN_METHOD, otpVerifiedAt, userAgent: input.userAgent?.slice(0, 300) ?? null, prevEvidenceHash: prev?.evidenceHash ?? null,
      };
      const created = await tx.agreementSignature.create({ data: { ...row, evidenceHash: sha256(evidencePayload(row)) }, select: { id: true, evidenceHash: true } });
      // طلبُ التوقيع يبقى سجلاً — ويُنشأ إن وقّع بلا طلب (من البوابة)
      await tx.agreementRequirement.upsert({
        where: { kind_subjectKind_subjectId: { kind: t.kind, subjectKind: acc.kind, subjectId: acc.id } },
        create: { kind: t.kind, subjectKind: acc.kind, subjectId: acc.id, subjectName: acc.name, subjectEmail: acc.email, reason: "وقّع من صفحة اتفاقياته", requiredByName: acc.name, sentAt: row.signedAt },
        update: {},
      });
      await audit(tx, ctx, created.id, "agreement.sign", {
        after: { kind: t.kind, version: t.version, documentHash: t.bodyHash, evidenceHash: created.evidenceHash, method: SIGN_METHOD },
      });
      return { wrong: false as const, id: created.id };
    });
    if (sig.wrong) return fail("رمز التحقّق غير صحيح");
    return { ok: true, signatureId: sig.id };
  } catch (e) {
    const s = String(e);
    if (s.includes("OTP_EXPIRED")) return fail("انتهت صلاحية رمز التحقّق أو لم يُطلب — اطلب رمزاً جديداً");
    if (s.includes("OTP_LOCKED")) return fail("تجاوزتَ عدد المحاولات — اطلب رمزاً جديداً");
    if (s.includes("Unique constraint") || s.includes("P2002")) return fail("وقّعتَ هذا الإصدار من قبل");
    throw e;
  }
}

/** **التحقّقُ من توقيع** — بصمةُ الوثيقة من نصّ الإصدار الآن، وبصمةُ الدليل من حقوله، وحلقتُه في السلسلة */
export async function verifySignature(id: string) {
  const s = await prisma.agreementSignature.findUnique({ where: { id }, include: { template: true } });
  if (!s) return null;
  const documentOk = documentHashOf(s.template.body) === s.documentHash && s.template.bodyHash === s.documentHash;
  const evidenceOk = sha256(evidencePayload(s)) === s.evidenceHash;
  const prev = await prisma.agreementSignature.findFirst({
    where: { OR: [{ signedAt: { lt: s.signedAt } }, { signedAt: s.signedAt, id: { lt: s.id } }] },
    orderBy: [{ signedAt: "desc" }, { id: "desc" }],
    select: { evidenceHash: true },
  });
  const chainOk = (prev?.evidenceHash ?? null) === (s.prevEvidenceHash ?? null);
  return { signature: s, documentOk, evidenceOk, chainOk, valid: documentOk && evidenceOk && chainOk };
}

// ═════════════════════════ الأصول ═════════════════════════

export async function grantAsset(ctx: AgreementContext, input: { category: AgreementKind; assetKey: string; holder: Subject }): Promise<Ok<{ id: string }>> {
  const blocked = await requireAgreementsManager(ctx, "agreement.asset.grant", subjectKey(input.holder));
  if (blocked) return blocked;
  const asset = AGREEMENT_ASSETS[input.category]?.find((a) => a.key === input.assetKey);
  if (!asset) return fail("أصلٌ غير معروف");
  const acc = await subjectAccount(input.holder);
  if (!acc) return fail("الحساب غير موجود أو غير نشط");
  const st = await statusOf(input.holder, input.category);
  if (st.status !== "signed") {
    await audit(prisma, ctx, subjectKey(input.holder), "agreement.asset.grant", { result: "denied", note: `لا توقيعَ ساريَ على ${AGREEMENT_KIND_LABEL[input.category]} (${AGREEMENT_STATUS_LABEL[st.status]})`, after: { asset: asset.label } });
    return fail(`لا يُمنح قبل التوقيع على الإصدار السارى من ${AGREEMENT_KIND_LABEL[input.category]} — حالتُه: ${AGREEMENT_STATUS_LABEL[st.status]}`);
  }
  const dup = await prisma.assetAccessGrant.findFirst({ where: { holderKind: input.holder.kind, holderId: input.holder.id, assetKind: asset.key, revokedAt: null }, select: { id: true } });
  if (dup) return fail("مُنح هذا الأصلُ له من قبل");
  const g = await prisma.$transaction(async (tx) => {
    const row = await tx.assetAccessGrant.create({
      data: { category: input.category, assetKind: asset.key, assetLabel: asset.label, holderKind: input.holder.kind, holderId: input.holder.id, holderName: acc.name, signatureId: st.signatureId!, grantedByName: ctx.account!.name },
      select: { id: true },
    });
    await audit(tx, ctx, row.id, "agreement.asset.grant", { after: { asset: asset.label, holder: acc.name, signatureId: st.signatureId } });
    return row;
  });
  return { ok: true, id: g.id };
}

export async function revokeAsset(ctx: AgreementContext, grantId: string, rawReason: unknown): Promise<Ok> {
  const blocked = await requireAgreementsManager(ctx, "agreement.asset.revoke", grantId);
  if (blocked) return blocked;
  const reason = String(rawReason ?? "").trim().slice(0, 300);
  if (reason.length < 3) return fail("اكتب سبب السحب");
  const w = await prisma.assetAccessGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: new Date(), revokedByName: ctx.account!.name, revokeReason: reason } });
  if (!w.count) return fail("سُحب من قبل");
  await audit(prisma, ctx, grantId, "agreement.asset.revoke", { note: reason });
  return { ok: true };
}

/** **عند الإنهاء أو التعطيل:** يُسحب كلُّ وصولٍ ممنوح، وتُعلَّم طلباتُ التوقيع «منتهية» (للإنهاء)، ويُسجَّل —
 *  وتبقى الاتفاقيةُ الموقّعة كما هي. يُستدعى من مسارات إنهاء العضوية وتعليقها وتنحية الحساب القياديّ. */
export async function revokeAccessOnExit(subject: Subject, opts: { reason: string; byName: string; ended: boolean }, db: Db = prisma) {
  const now = new Date();
  const grants = await db.assetAccessGrant.updateMany({ where: { holderKind: subject.kind, holderId: subject.id, revokedAt: null }, data: { revokedAt: now, revokedByName: opts.byName, revokeReason: opts.reason } });
  const reqs = opts.ended
    ? await db.agreementRequirement.updateMany({ where: { subjectKind: subject.kind, subjectId: subject.id, endedAt: null, cancelledAt: null }, data: { endedAt: now, endReason: opts.reason } })
    : { count: 0 };
  // وتكليفُه في الإدارة العليا ينتهي بانتهاء عضويته (يبقى سجلاً تاريخياً) — والإيقافُ المؤقت يسحب صلاحياته
  // تلقائياً لأن حسابه معطَّل (`seniorContext`)، فلا يُمسّ التكليف
  if (opts.ended) {
    const live = await db.seniorPosition.findMany({
      where: { ...(subject.kind === "member" ? { holderMemberId: subject.id } : { holderUserId: subject.id }), status: { in: ["active", "suspended"] } },
      select: { id: true, status: true, departmentId: true },
    });
    for (const p of live) {
      const w = await db.seniorPosition.updateMany({ where: { id: p.id, status: p.status }, data: { status: "ended", endedAt: now, endedByName: opts.byName, endReason: opts.reason } });
      if (w.count) {
        await recordOrgEvent(db, {
          scope: "senior", entityId: p.id, departmentId: p.departmentId, action: "senior.position.status",
          actor: { kind: "system", id: "system", name: opts.byName, role: "system" },
          before: { status: p.status }, after: { status: "ended" }, note: opts.reason,
        });
      }
    }
  }
  if (grants.count || reqs.count) {
    await recordOrgEvent(db, {
      scope: "agreement", entityId: subjectKey(subject), departmentId: EVENT_DEPT, action: opts.ended ? "agreement.access.ended" : "agreement.access.suspended",
      actor: { kind: "system", id: "system", name: opts.byName, role: "system" },
      after: { revokedGrants: grants.count, endedRequirements: reqs.count }, note: opts.reason,
    });
  }
  return { revoked: grants.count, ended: reqs.count };
}

// ═════════════════════════ البلاغات (مراجعةٌ بشرية) ═════════════════════════

export async function reportIncident(ctx: AgreementContext, input: { kind: AgreementKind; subject: Subject; description: unknown; evidence?: unknown }): Promise<Ok<{ id: string }>> {
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (!ctx.canView) return fail("الإبلاغُ لمن يطّلع على الاتفاقيات — أو عبر تذكرةٍ إلى الإدارة");
  const acc =
    input.subject.kind === "user"
      ? await prisma.user.findUnique({ where: { id: input.subject.id }, select: { fullName: true } })
      : await prisma.member.findUnique({ where: { id: input.subject.id }, select: { fullName: true } });
  if (!acc) return fail("الشخص غير موجود");
  const description = String(input.description ?? "").trim().slice(0, 4000);
  if (description.length < 10) return fail("صف ما حدث بوضوح");
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.agreementIncident.create({
      data: { kind: input.kind, subjectKind: input.subject.kind, subjectId: input.subject.id, subjectName: acc.fullName, description, evidence: String(input.evidence ?? "").trim().slice(0, 4000) || null, reportedByName: ctx.account!.name },
      select: { id: true },
    });
    await audit(tx, ctx, r.id, "agreement.incident.report", { after: { kind: input.kind, subject: acc.fullName } });
    return r;
  });
  return { ok: true, id: row.id };
}

const INCIDENT_FLOW: Record<string, string[]> = { reported: ["under_review", "closed"], under_review: ["closed"], closed: [] };

export async function reviewIncident(ctx: AgreementContext, id: string, input: { to: "under_review" | "closed"; note: unknown; outcome?: unknown }): Promise<Ok> {
  const blocked = await requireAgreementsManager(ctx, "agreement.incident.review", id);
  if (blocked) return blocked;
  const i = await prisma.agreementIncident.findUnique({ where: { id }, select: { status: true, reportedByName: true } });
  if (!i) return fail("البلاغ غير موجود");
  if (!INCIDENT_FLOW[i.status]?.includes(input.to)) return fail("انتقالٌ غير مسموح");
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (note.length < 5) return fail("اكتب ملاحظة المراجعة");
  const outcome = String(input.outcome ?? "").trim().slice(0, 600) || null;
  if (input.to === "closed" && !outcome) return fail("اكتب نتيجة المراجعة البشرية");
  const w = await prisma.agreementIncident.updateMany({
    where: { id, status: i.status },
    data: { status: input.to, reviewNote: note, reviewedByName: ctx.account!.name, ...(input.to === "closed" ? { outcome, closedAt: new Date() } : {}) },
  });
  if (!w.count) return fail("تغيّرت حالةُ البلاغ للتوّ");
  await audit(prisma, ctx, id, "agreement.incident.review", { before: { status: i.status }, after: { status: input.to, outcome }, note });
  return { ok: true };
}

// ═════════════════════════ سجلُّ الشخص (المساءلة) ═════════════════════════

export async function personRecord(subject: Subject) {
  const [signatures, requirements, grants, incidents, events] = await Promise.all([
    prisma.agreementSignature.findMany({ where: { signerKind: subject.kind, signerId: subject.id }, orderBy: { signedAt: "desc" } }),
    prisma.agreementRequirement.findMany({ where: { subjectKind: subject.kind, subjectId: subject.id } }),
    prisma.assetAccessGrant.findMany({ where: { holderKind: subject.kind, holderId: subject.id }, orderBy: { grantedAt: "desc" } }),
    prisma.agreementIncident.findMany({ where: { subjectKind: subject.kind, subjectId: subject.id }, orderBy: { reportedAt: "desc" } }),
    prisma.orgAuditEvent.findMany({ where: { scope: "agreement", OR: [{ entityId: subjectKey(subject) }, { actorId: subject.id }] }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const statuses = { marketing: await statusOf(subject, "marketing"), technical: await statusOf(subject, "technical") };
  return { signatures, requirements, grants, incidents, events, statuses };
}

/** لوحةُ الإدارة: كلُّ من له طلبٌ أو توقيع، بحالته لكل نوع */
export async function agreementsRoster() {
  const [reqs, sigs] = await Promise.all([
    prisma.agreementRequirement.findMany({ orderBy: { requiredAt: "desc" }, take: 1000 }),
    prisma.agreementSignature.findMany({ select: { signerKind: true, signerId: true, signerAccountName: true, signerEmail: true }, distinct: ["signerKind", "signerId"], take: 1000 }),
  ]);
  const people = new Map<string, { subject: Subject; name: string; email: string }>();
  for (const r of reqs) people.set(`${r.subjectKind}:${r.subjectId}`, { subject: { kind: r.subjectKind as Subject["kind"], id: r.subjectId }, name: r.subjectName, email: r.subjectEmail });
  for (const s of sigs) if (!people.has(`${s.signerKind}:${s.signerId}`)) people.set(`${s.signerKind}:${s.signerId}`, { subject: { kind: s.signerKind as Subject["kind"], id: s.signerId }, name: s.signerAccountName, email: s.signerEmail });
  const rows = await Promise.all(
    [...people.values()].map(async (p) => ({
      ...p,
      key: subjectKey(p.subject),
      marketing: await statusOf(p.subject, "marketing"),
      technical: await statusOf(p.subject, "technical"),
      requirements: reqs.filter((r) => r.subjectKind === p.subject.kind && r.subjectId === p.subject.id),
    }))
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export const parseSubject = (key: string): Subject | null => {
  const m = /^(user|member):([A-Za-z0-9_-]{6,64})$/.exec(key);
  return m ? { kind: m[1] as Subject["kind"], id: m[2] } : null;
};
