import { createHash, randomBytes } from "node:crypto";
import type { Prisma, SeniorCapability, SeniorPositionStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { recordOrgEvent, diffFields } from "@/lib/org/audit";
import { hashPassword } from "@/lib/credentials";
import { appBaseUrl } from "@/lib/emailBrand";
import { currentSeniorLeadership, type SeniorLeadership } from "./leadership";

/** **الإدارةُ العليا الديناميكية** — مسمّياتٌ يحدّدها القائد، وتكليفاتٌ بدعوات، وصلاحياتٌ محدّدة لكل عضو.
 *
 *  - **من يُدير:** قائدُ الإدارة العليا وحده (`leadership.ts`: الرئيسُ التنفيذي، وإلا المؤسس) — ينشئ الدعوات
 *    ويحدّد المسمّى والوصف والمسؤوليات والصلاحيات وتاريخَ البدء والحالة والملاحظات، ويعدّلها ويوقفها وينهيها.
 *  - **المسمّى حرّ** (عربيٌّ وإنجليزيٌّ اختياري) — لا قائمةَ مقفلة. **والصلاحياتُ قائمةٌ مضبوطة** في الشيفرة
 *    (`SENIOR_CAPABILITIES`) لا تشمل شيئاً من القيادة: لا يمنح القائدُ أحداً صلاحيةَ دعوةٍ أو تعيين، فلا يصير
 *    عضوٌ قائداً ولا يتجاوز أحدٌ من دعاه.
 *  - **لا يعدّل أحدٌ تكليفَه هو** (ولا القائدُ نفسه — القائدُ لا تكليفَ له). وكلُّ تغييرٍ يُسجَّل بقيمته قبل وبعد.
 *  - **حالاتُ الدعوة:** مسودّة ← مرسلة ← فُتحت (بانتظار القبول) ← مقبولة؛ أو منتهية (بالوقت) أو ملغاة (بقرار).
 *  - **حالاتُ التكليف:** بانتظار القبول ← نشط ⇄ موقوف ← منتهٍ. ولا يُحذف تكليفٌ — المنتهي سجلٌّ تاريخي. */

type Db = Prisma.TransactionClient | typeof prisma;

export const SENIOR_CAPABILITIES: { key: SeniorCapability; label: string; can: string }[] = [
  { key: "board_view", label: "لوحة الإدارة العليا", can: "يرى القائدَ والمناصبَ وأعضاءها ومسؤولياتهم" },
  { key: "committees_view", label: "لجان الإدارة العليا", can: "يطّلع على لجان الإدارة العليا وحالاتها" },
  { key: "governance_log_view", label: "سجل الحوكمة", can: "يقرأ سجلَّ العمليات الإدارية الحساسة (قراءةً فقط)" },
  { key: "agreements_view", label: "الاتفاقيات (اطّلاع)", can: "يرى الاتفاقياتِ ومن وقّع ومن لم يوقّع" },
  { key: "agreements_manage", label: "الاتفاقيات (إدارة)", can: "يُصدر إصداراً جديداً ويطلب التوقيع وإعادتَه ويراجع البلاغات" },
];
const CAP_KEYS = new Set<SeniorCapability>(SENIOR_CAPABILITIES.map((c) => c.key));
export const INVITE_DAYS = 7;

export const INVITE_STATE_LABEL: Record<string, string> = {
  draft: "مسودّة",
  sent: "مرسلة",
  opened: "بانتظار القبول",
  accepted: "مقبولة",
  expired: "منتهية",
  cancelled: "ملغاة",
};
export const POSITION_STATUS_LABEL: Record<SeniorPositionStatus, string> = {
  pending: "بانتظار القبول",
  active: "نشط",
  suspended: "موقوف",
  ended: "منتهٍ",
};

export type SeniorContext = {
  account: { kind: "user" | "member"; id: string; name: string; role: string; email: string } | null;
  leadership: SeniorLeadership | null;
  isLeader: boolean;
  isFounder: boolean;
  /** تكليفُه النشط في الإدارة العليا إن كان له */
  position: { id: string; titleAr: string; titleEn: string | null; responsibilities: string | null; capabilities: SeniorCapability[] } | null;
  capabilities: Set<SeniorCapability>;
};

/** **صاحبُ الطلب في الإدارة العليا — من القاعدة لا من الجلسة:** القائد، والمؤسس (إشرافٌ واطّلاع)، والرئيس
 *  التنفيذي، ومسؤول التشغيل (اطّلاعٌ ومتابعة)، وأصحابُ التكليفات النشطة بصلاحياتهم المحدّدة وحدها. */
export async function seniorContext(session: Session | null): Promise<SeniorContext> {
  const empty: SeniorContext = { account: null, leadership: null, isLeader: false, isFounder: false, position: null, capabilities: new Set() };
  if (!session?.user?.id) return empty;
  const isMember = session.user.role === "member";
  const acc = isMember
    ? await prisma.member.findUnique({ where: { id: session.user.id }, select: { id: true, fullName: true, email: true, isActive: true, terminatedAt: true, approvalStatus: true } })
    : await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, fullName: true, email: true, isActive: true, role: true } });
  if (!acc || !acc.isActive) return empty;
  if ("terminatedAt" in acc && (acc.terminatedAt || acc.approvalStatus !== "approved")) return empty;
  const role = "role" in acc ? acc.role : "member";
  const leadership = await currentSeniorLeadership();
  const isLeader = !isMember && !!leadership?.leader && leadership.leader.id === acc.id;
  const isFounder = role === "super_admin";
  const position = await prisma.seniorPosition.findFirst({
    where: { status: "active", ...(isMember ? { holderMemberId: acc.id } : { holderUserId: acc.id }) },
    select: { id: true, titleAr: true, titleEn: true, responsibilities: true, capabilities: true },
    orderBy: { acceptedAt: "desc" },
  });
  const caps = new Set<SeniorCapability>();
  if (isLeader || isFounder || role === "executive") for (const c of CAP_KEYS) caps.add(c);
  else if (role === "operations_officer") ["board_view", "committees_view", "governance_log_view"].forEach((c) => caps.add(c as SeniorCapability));
  for (const c of position?.capabilities ?? []) caps.add(c);
  return {
    account: { kind: isMember ? "member" : "user", id: acc.id, name: acc.fullName, role, email: acc.email },
    leadership,
    isLeader,
    isFounder,
    position,
    capabilities: caps,
  };
}

/** صلاحياتُ القائمة الجانبية — قراءةٌ واحدةٌ خفيفة في كل صفحة (لا مطابقةَ قيادةٍ ولا حسابات): المؤسسُ
 *  والرئيسُ التنفيذي (والقائدُ أحدُهما دائماً) كلُّها، ومسؤولُ التشغيل الاطّلاع، وغيرُهم ما في تكليفه النشط.
 *  عرضٌ لا إذن: كلُّ صفحةٍ وإجراءٍ يفحص `seniorContext` من القاعدة ثانيةً. */
export async function seniorNavCapabilities(session: Session | null): Promise<Set<SeniorCapability>> {
  const caps = new Set<SeniorCapability>();
  const role = session?.user?.role;
  if (!session?.user?.id || !role) return caps;
  if (role === "super_admin" || role === "executive") return new Set(CAP_KEYS);
  if (role === "operations_officer") (["board_view", "committees_view", "governance_log_view"] as const).forEach((c) => caps.add(c));
  const pos = await prisma.seniorPosition.findFirst({
    where: { status: "active", ...(role === "member" ? { holderMemberId: session.user.id } : { holderUserId: session.user.id }) },
    select: { capabilities: true },
  });
  for (const c of pos?.capabilities ?? []) caps.add(c);
  return caps;
}

type Ok<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };
const fail = (reason: string) => ({ ok: false as const, reason });

function clean(v: unknown, max: number): string | null {
  const s = String(v ?? "").replace(/\r/g, "").trim();
  return s ? s.slice(0, max) : null;
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type PositionInput = {
  titleAr: unknown;
  titleEn?: unknown;
  description?: unknown;
  responsibilities?: unknown;
  capabilities?: unknown;
  startDate?: unknown;
  notes?: unknown;
};

function parsePosition(input: PositionInput): Ok<{ data: { titleAr: string; titleEn: string | null; description: string | null; responsibilities: string | null; capabilities: SeniorCapability[]; startDate: Date | null; notes: string | null } }> {
  const titleAr = clean(input.titleAr, 80);
  if (!titleAr || titleAr.length < 2) return fail("اكتب المسمّى الإداري بالعربية");
  const titleEn = clean(input.titleEn, 80);
  if (titleEn && !/^[A-Za-z0-9 .,&()'\-/]+$/.test(titleEn)) return fail("المسمّى الإنجليزي بحروفٍ إنجليزية");
  const raw = Array.isArray(input.capabilities) ? input.capabilities.map(String) : [];
  const unknown = raw.filter((c) => !CAP_KEYS.has(c as SeniorCapability));
  if (unknown.length) return fail("صلاحيةٌ غير معروفة — الصلاحياتُ من القائمة المعتمدة وحدها");
  const capabilities = [...new Set(raw)] as SeniorCapability[];
  if (!capabilities.includes("board_view")) capabilities.unshift("board_view");
  let startDate: Date | null = null;
  if (input.startDate) {
    const d = new Date(String(input.startDate));
    if (Number.isNaN(d.getTime())) return fail("تاريخ البدء غير صالح");
    startDate = d;
  }
  return {
    ok: true,
    data: {
      titleAr,
      titleEn,
      description: clean(input.description, 600),
      responsibilities: clean(input.responsibilities, 1500),
      capabilities,
      startDate,
      notes: clean(input.notes, 600),
    },
  };
}

async function audit(db: Db, ctx: SeniorContext, deptId: string, entityId: string, action: string, extra: { before?: Prisma.InputJsonValue | null; after?: Prisma.InputJsonValue | null; note?: string | null; result?: "success" | "denied" }) {
  await recordOrgEvent(db, {
    scope: "senior",
    entityId,
    departmentId: deptId,
    action,
    actor: { kind: ctx.account?.kind ?? "system", id: ctx.account?.id ?? "anonymous", name: ctx.account?.name ?? "—", role: ctx.account?.role ?? null },
    ...extra,
  });
}

/** المحاولةُ المرفوضة لإجراءٍ قياديٍّ حساس تُسجَّل — من حاول، وماذا */
async function denied(ctx: SeniorContext, action: string, entityId: string, reason: string) {
  const deptId = ctx.leadership?.departmentId;
  if (deptId && ctx.account) await audit(prisma, ctx, deptId, entityId, action, { note: reason, result: "denied" }).catch(() => {});
  return fail(reason);
}

function requireLeader(ctx: SeniorContext, action: string, entityId: string) {
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (!ctx.leadership) return fail("لا قسمَ للإدارة العليا في المنصة");
  if (!ctx.isLeader) {
    return denied(
      ctx,
      action,
      entityId,
      ctx.leadership.leader
        ? `إدارةُ عضوية الإدارة العليا لقائدها (${ctx.leadership.leader.fullName}) وحده`
        : "لا قائدَ نشطاً للإدارة العليا الآن"
    );
  }
  return null;
}

async function sendInvite(id: string, ctx: SeniorContext) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const row = await prisma.seniorPosition.update({
    where: { id },
    data: { inviteTokenHash: tokenHash(token), inviteExpiresAt: expiresAt, inviteState: "sent", sentAt: new Date(), openedAt: null },
    select: { inviteEmail: true, inviteName: true, titleAr: true },
  });
  const { sendSeniorInvitationEmail } = await import("@/lib/email");
  const acceptUrl = `${appBaseUrl()}/senior/invite/${token}`;
  const mail = await sendSeniorInvitationEmail({
    to: row.inviteEmail,
    fullName: row.inviteName,
    titleAr: row.titleAr,
    inviterName: ctx.account!.name,
    acceptUrl,
    expiresAt,
  });
  if (process.env.NODE_ENV !== "production" && mail.skipped) console.warn(`[dev] رابط دعوة الإدارة العليا ${row.inviteEmail}: ${acceptUrl}`);
  return { token, expiresAt, delivered: !mail.skipped };
}

/** **دعوةٌ جديدة** — مسودّةً أو مرسلةً فوراً */
export async function createSeniorInvitation(
  ctx: SeniorContext,
  input: PositionInput & { inviteName: unknown; inviteEmail: unknown; send?: boolean }
): Promise<Ok<{ id: string; delivered?: boolean }>> {
  const blocked = requireLeader(ctx, "senior.invite.create", "new");
  if (blocked) return blocked;
  const parsed = parsePosition(input);
  if (!parsed.ok) return parsed;
  const inviteName = clean(input.inviteName, 120);
  const inviteEmail = (clean(input.inviteEmail, 200) ?? "").toLowerCase();
  if (!inviteName || inviteName.length < 3) return fail("اكتب اسم المدعوّ كاملاً");
  if (!EMAIL.test(inviteEmail)) return fail("البريد الإلكتروني غير صالح");
  // القائدُ والمؤسسُ والرئيسُ التنفيذي لا يُدعَون إلى منصبٍ في الإدارة العليا — هم قيادتُها
  const top = await prisma.user.findFirst({
    where: { email: { equals: inviteEmail, mode: "insensitive" }, isActive: true, role: { in: ["super_admin", "executive"] } },
    select: { id: true },
  });
  if (top) return fail("هذا البريدُ لحسابٍ قياديّ (المؤسس أو الرئيس التنفيذي) — لا يُدعى إلى منصب");
  const deptId = ctx.leadership!.departmentId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.seniorPosition.create({
        data: { ...parsed.data, departmentId: deptId, inviteName, inviteEmail, invitedById: ctx.account!.id, invitedByName: ctx.account!.name },
        select: { id: true },
      });
      await audit(tx, ctx, deptId, created.id, "senior.invite.create", {
        after: { ...parsed.data, startDate: parsed.data.startDate?.toISOString().slice(0, 10) ?? null, inviteName, inviteEmail },
      });
      return created;
    });
    if (input.send) {
      const s = await sendInvite(row.id, ctx);
      await audit(prisma, ctx, deptId, row.id, "senior.invite.send", { after: { expiresAt: s.expiresAt.toISOString() } });
      return { ok: true, id: row.id, delivered: s.delivered };
    }
    return { ok: true, id: row.id };
  } catch (e) {
    if (String(e).includes("SENIOR_POSITION_DUPLICATE")) return fail("لهذا البريد دعوةٌ أو تكليفٌ قائمٌ في الإدارة العليا");
    throw e;
  }
}

/** إرسالُ مسودّة، أو إعادةُ إرسال دعوةٍ (رمزٌ جديد يُبطل القديم ومهلةٌ جديدة) */
export async function sendSeniorInvitation(ctx: SeniorContext, positionId: string): Promise<Ok<{ delivered: boolean }>> {
  const blocked = requireLeader(ctx, "senior.invite.send", positionId);
  if (blocked) return blocked;
  const p = await prisma.seniorPosition.findUnique({ where: { id: positionId }, select: { inviteState: true, status: true, departmentId: true } });
  if (!p) return fail("الدعوة غير موجودة");
  if (p.status !== "pending" || !["draft", "sent", "opened", "expired"].includes(p.inviteState)) return fail("لا تُرسَل هذه الدعوة في حالتها الحالية");
  try {
    const s = await sendInvite(positionId, ctx);
    await audit(prisma, ctx, p.departmentId, positionId, p.inviteState === "draft" ? "senior.invite.send" : "senior.invite.resend", {
      before: { state: p.inviteState },
      after: { state: "sent", expiresAt: s.expiresAt.toISOString() },
    });
    return { ok: true, delivered: s.delivered };
  } catch (e) {
    if (String(e).includes("SENIOR_POSITION_DUPLICATE")) return fail("لهذا البريد دعوةٌ أو تكليفٌ قائمٌ آخر");
    throw e;
  }
}

/** إلغاءُ دعوةٍ لم تُقبل — بسبب */
export async function cancelSeniorInvitation(ctx: SeniorContext, positionId: string, rawReason: unknown): Promise<Ok> {
  const blocked = requireLeader(ctx, "senior.invite.cancel", positionId);
  if (blocked) return blocked;
  const reason = clean(rawReason, 400);
  if (!reason || reason.length < 3) return fail("اكتب سبب الإلغاء");
  const p = await prisma.seniorPosition.findUnique({ where: { id: positionId }, select: { inviteState: true, departmentId: true } });
  if (!p) return fail("الدعوة غير موجودة");
  const w = await prisma.$transaction(async (tx) => {
    const r = await tx.seniorPosition.updateMany({
      where: { id: positionId, status: "pending", inviteState: { in: ["draft", "sent", "opened", "expired"] } },
      data: { inviteState: "cancelled", inviteTokenHash: null, cancelledAt: new Date(), cancelledByName: ctx.account!.name, cancelReason: reason, status: "ended", endedAt: new Date(), endReason: "أُلغيت الدعوة" },
    });
    if (r.count) await audit(tx, ctx, p.departmentId, positionId, "senior.invite.cancel", { before: { state: p.inviteState }, after: { state: "cancelled" }, note: reason });
    return r.count;
  });
  return w ? { ok: true } : fail("لا تُلغى هذه الدعوة في حالتها الحالية");
}

/** تعديلُ تكليف — المسمّى والوصف والمسؤوليات والصلاحيات والتاريخ والملاحظات؛ بقيمها قبل وبعد */
export async function updateSeniorPosition(ctx: SeniorContext, positionId: string, input: PositionInput): Promise<Ok> {
  const blocked = requireLeader(ctx, "senior.position.update", positionId);
  if (blocked) return blocked;
  const parsed = parsePosition(input);
  if (!parsed.ok) return parsed;
  const p = await prisma.seniorPosition.findUnique({ where: { id: positionId } });
  if (!p) return fail("التكليف غير موجود");
  if (p.status === "ended") return fail("تكليفٌ منتهٍ لا يُعدَّل — هو سجلٌّ تاريخي");
  if (p.holderUserId === ctx.account!.id) return denied(ctx, "senior.position.update", positionId, "لا يعدّل أحدٌ تكليفَه هو");
  const before = {
    titleAr: p.titleAr, titleEn: p.titleEn, description: p.description, responsibilities: p.responsibilities,
    capabilities: [...p.capabilities].sort().join(","), startDate: p.startDate, notes: p.notes,
  };
  const after = { ...parsed.data, capabilities: [...parsed.data.capabilities].sort().join(",") };
  const diff = diffFields(before, after);
  if (!diff) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.seniorPosition.update({ where: { id: positionId }, data: parsed.data });
    await audit(tx, ctx, p.departmentId, positionId, "capabilities" in diff.after ? "senior.position.permissions" : "senior.position.update", {
      before: diff.before as Prisma.InputJsonValue,
      after: diff.after as Prisma.InputJsonValue,
    });
  });
  return { ok: true };
}

const STATUS_FLOW: Record<SeniorPositionStatus, SeniorPositionStatus[]> = {
  pending: [],
  active: ["suspended", "ended"],
  suspended: ["active", "ended"],
  ended: [],
};

/** إيقافُ تكليفٍ أو إعادتُه أو إنهاؤه — بسببٍ مكتوب، ولا يُحذف */
export async function setSeniorPositionStatus(ctx: SeniorContext, positionId: string, to: SeniorPositionStatus, rawReason: unknown): Promise<Ok> {
  const blocked = requireLeader(ctx, "senior.position.status", positionId);
  if (blocked) return blocked;
  const reason = clean(rawReason, 400);
  if (!reason || reason.length < 3) return fail("اكتب السبب");
  const p = await prisma.seniorPosition.findUnique({ where: { id: positionId }, select: { status: true, departmentId: true, holderUserId: true } });
  if (!p) return fail("التكليف غير موجود");
  if (p.holderUserId === ctx.account!.id) return denied(ctx, "senior.position.status", positionId, "لا يغيّر أحدٌ حالةَ تكليفه هو");
  if (!STATUS_FLOW[p.status].includes(to)) return fail("هذا الانتقال غير مسموح من حالته الحالية");
  const now = new Date();
  const w = await prisma.$transaction(async (tx) => {
    const r = await tx.seniorPosition.updateMany({
      where: { id: positionId, status: p.status },
      data: { status: to, ...(to === "ended" ? { endedAt: now, endedByName: ctx.account!.name, endReason: reason } : {}) },
    });
    if (r.count) await audit(tx, ctx, p.departmentId, positionId, "senior.position.status", { before: { status: p.status }, after: { status: to }, note: reason });
    return r.count;
  });
  return w ? { ok: true } : fail("تغيّرت حالةُ التكليف للتوّ — حدّث الصفحة");
}

/** **فتحُ الدعوة برابطها** — لا تحتاج جلسة؛ تُعلَّم «بانتظار القبول»، وتنتهي بوقتها */
export async function openSeniorInvitation(token: string) {
  if (!token || token.length < 20) return null;
  const p = await prisma.seniorPosition.findUnique({
    where: { inviteTokenHash: tokenHash(token) },
    select: {
      id: true, titleAr: true, titleEn: true, description: true, responsibilities: true, capabilities: true, startDate: true,
      inviteName: true, inviteEmail: true, inviteState: true, inviteExpiresAt: true, invitedById: true, invitedByName: true, status: true, departmentId: true,
      department: { select: { name: true } },
    },
  });
  if (!p) return null;
  if (["sent", "opened"].includes(p.inviteState) && p.inviteExpiresAt && p.inviteExpiresAt < new Date()) {
    await prisma.seniorPosition.updateMany({ where: { id: p.id, inviteState: { in: ["sent", "opened"] } }, data: { inviteState: "expired", inviteTokenHash: null } });
    await recordOrgEvent(prisma, { scope: "senior", entityId: p.id, departmentId: p.departmentId, action: "senior.invite.expired", actor: { kind: "system", id: "system", name: "المنصة — آلياً", role: "system" }, before: { state: p.inviteState }, after: { state: "expired" } });
    return { ...p, inviteState: "expired" as const };
  }
  if (p.inviteState === "sent") {
    await prisma.seniorPosition.updateMany({ where: { id: p.id, inviteState: "sent" }, data: { inviteState: "opened", openedAt: new Date() } });
    return { ...p, inviteState: "opened" as const };
  }
  return p;
}

/** **قبولُ الدعوة** — بحسابٍ قائمٍ بالبريد نفسه (بعد الدخول)، أو بإنشاء حسابٍ جديد بكلمة مرور.
 *  الرابطُ يصل البريدَ وحده، فامتلاكُه إثباتٌ لملكية البريد — ويُبطَل بعد القبول. */
export async function acceptSeniorInvitation(
  token: string,
  opts: { session: Session | null; password?: unknown }
): Promise<Ok<{ mode: "linked" | "created" }> | { ok: false; reason: string; code: "login_required" }> {
  const p = await openSeniorInvitation(token);
  if (!p) return fail("الرابط غير صالح أو استُعمل من قبل");
  if (p.inviteState === "expired") return fail("انتهت مدّة الدعوة — اطلب من قائد الإدارة العليا إعادة إرسالها");
  if (!["sent", "opened"].includes(p.inviteState) || p.status !== "pending") return fail("هذه الدعوة لم تعد قائمة");
  const email = p.inviteEmail.toLowerCase();
  const [user, member] = await Promise.all([
    prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, isActive: true, role: true, fullName: true } }),
    prisma.member.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, isActive: true, terminatedAt: true, fullName: true } }),
  ]);
  const session = opts.session;
  let holder: { kind: "user" | "member"; id: string; name: string } | null = null;
  let mode: "linked" | "created" = "linked";
  let newPasswordHash: string | null = null;

  if (user?.isActive || (member && member.isActive && !member.terminatedAt)) {
    // حسابٌ قائمٌ بهذا البريد: يقبل صاحبُه بعد الدخول به — لا أحدٌ غيرُه
    const sid = session?.user?.id;
    const own = user?.isActive ? { kind: "user" as const, id: user.id, name: user.fullName } : { kind: "member" as const, id: member!.id, name: member!.fullName };
    if (!sid || sid !== own.id) return { ok: false, reason: "لهذا البريد حسابٌ في المنصة — سجّل الدخول به ثم افتح الرابط مرّةً أخرى", code: "login_required" };
    if (user?.isActive && (user.role === "super_admin" || user.role === "executive")) return fail("الحسابُ القياديّ لا يقبل منصباً في الإدارة العليا");
    holder = own;
  } else if (user || member) {
    return fail("لهذا البريد حسابٌ معطَّل — تواصل مع الإدارة");
  } else {
    const pw = String(opts.password ?? "");
    if (pw.length < 10) return fail("كلمة المرور عشرة أحرفٍ على الأقل");
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return fail("كلمة المرور تجمع حروفاً وأرقاماً");
    newPasswordHash = await hashPassword(pw);
    mode = "created";
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      if (mode === "created") {
        // عضوٌ جديد في الإدارة العليا — الدعوةُ هي الاعتماد (لا اختبار)، والبريدُ مثبَتٌ بالرابط
        const track = await tx.testTrack.findFirst({ where: { scope: "department_member" }, orderBy: { createdAt: "asc" }, select: { id: true } });
        if (!track) throw new Error("NO_TRACK");
        const inv = await tx.invite.create({
          data: { fullName: p.inviteName, email, targetRole: "member", departmentId: p.departmentId, testTrackId: track.id, invitedById: p.invitedById, status: "used" },
        });
        const m = await tx.member.create({
          data: {
            fullName: p.inviteName, email, departmentId: p.departmentId, inviteId: inv.id, passwordHash: newPasswordHash!,
            mustChangePassword: false, approvalStatus: "approved", decidedAt: now, credentialsIssuedAt: now, isActive: true, jobTitle: p.titleAr,
          },
          select: { id: true, fullName: true },
        });
        holder = { kind: "member", id: m.id, name: m.fullName };
      }
      const h = holder!;
      const w = await tx.seniorPosition.updateMany({
        where: { id: p.id, status: "pending", inviteState: { in: ["sent", "opened"] } },
        data: {
          status: "active", inviteState: "accepted", acceptedAt: now, inviteTokenHash: null, startDate: p.startDate ?? now,
          ...(h.kind === "member" ? { holderMemberId: h.id } : { holderUserId: h.id }),
        },
      });
      if (!w.count) throw new Error("RACE");
      await recordOrgEvent(tx, {
        scope: "senior", entityId: p.id, departmentId: p.departmentId, action: "senior.invite.accept",
        actor: { kind: h.kind, id: h.id, name: h.name, role: h.kind === "member" ? "member" : null },
        before: { state: p.inviteState }, after: { state: "accepted", holder: h.name, mode, titleAr: p.titleAr },
      });
    });
  } catch (e) {
    if (String(e).includes("RACE")) return fail("قُبلت الدعوة للتوّ أو تغيّرت — حدّث الصفحة");
    if (String(e).includes("NO_TRACK")) return fail("تعذّر إنشاء الحساب — لا مسارَ في المنصة؛ تواصل مع الإدارة");
    throw e;
  }
  return { ok: true, mode };
}

/** لوحةُ الإدارة العليا: القيادة، والمقاعد القيادية بأدوارها، والتكليفات بحالاتها */
export async function seniorBoard(includeInvitations: boolean) {
  const leadership = await currentSeniorLeadership();
  if (!leadership) return null;
  const [seats, positions] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, role: { in: ["super_admin", "executive", "operations_officer"] } },
      select: { id: true, fullName: true, role: true, jobTitle: true, createdAt: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.seniorPosition.findMany({
      where: includeInvitations ? {} : { status: { in: ["active", "suspended"] } },
      include: { holderMember: { select: { fullName: true, email: true } }, holderUser: { select: { fullName: true, email: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 300,
    }),
  ]);
  const now = Date.now();
  return {
    leadership,
    seats,
    positions: positions.map((p) => ({
      ...p,
      // انتهاءُ المهلة يُقرأ لحظياً — ولا ينتظر من يفتح الرابط
      inviteState: ["sent", "opened"].includes(p.inviteState) && p.inviteExpiresAt && p.inviteExpiresAt.getTime() < now ? ("expired" as const) : p.inviteState,
      holderName: p.holderMember?.fullName ?? p.holderUser?.fullName ?? null,
    })),
  };
}
