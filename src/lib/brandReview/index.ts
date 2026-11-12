import type { BrandItemStatus, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { recordOrgEvent } from "@/lib/org/audit";
import { seniorContext } from "@/lib/governance/senior";
import { BRAND_VERSION } from "@/lib/brand2026/tokens";
import { BRAND_ITEMS, itemDef, contentHashOf } from "./registry";

/** **مركزُ مراجعة واعتماد الهوية — سير العمل.**
 *
 *  - **من يُعدّ:** المؤسس والرئيس التنفيذي، ومن له «إعداد عناصر الهوية» (`brand_prepare`) — يرسل للمراجعة، ويعيد
 *    الإعداد بعد طلب التعديل. **لا يعتمد ولا ينشر.**
 *  - **من يعتمد وينشر ويفعّل:** المؤسس وحده (`super_admin` من القاعدة).
 *  - **الحالات:** مسودّة ← جاهز للمراجعة ← بانتظار الاعتماد ← (يحتاج تعديلات ← مسودّة بمراجعةٍ أعلى) ← معتمد ← منشور.
 *  - **لا يُنشر ما تغيّر بعد اعتماده:** البصمةُ وقتَ الاعتماد تُقارَن بالحالية؛ ولا يُنشر ما لم يُطبَّق في المنصة.
 *  - **السجل:** كلُّ انتقالٍ وملاحظةٍ في `BrandReviewEvent` (لا يُعدَّل ولا يُحذف)، والقراراتُ في سجل الحوكمة أيضاً. */

export const STATUS_LABEL: Record<BrandItemStatus, string> = {
  draft: "مسودة",
  ready_for_review: "جاهز للمراجعة",
  pending_approval: "بانتظار الاعتماد",
  changes_requested: "يحتاج إلى تعديلات",
  approved: "معتمد",
  published: "منشور",
};

export type BrandCtx = {
  account: { kind: "user" | "member"; id: string; name: string; role: string } | null;
  canView: boolean;
  canPrepare: boolean;
  canApprove: boolean;
};

export async function brandContext(session: Session | null): Promise<BrandCtx> {
  const s = await seniorContext(session);
  if (!s.account) return { account: null, canView: false, canPrepare: false, canApprove: false };
  const canApprove = s.account.role === "super_admin";
  const canPrepare = canApprove || s.capabilities.has("brand_prepare");
  return { account: { kind: s.account.kind, id: s.account.id, name: s.account.name, role: s.account.role }, canView: canPrepare, canPrepare, canApprove };
}

type Ok = { ok: true } | { ok: false; reason: string };
const fail = (reason: string) => ({ ok: false as const, reason });

async function denied(ctx: BrandCtx, action: string, entityId: string, reason: string) {
  if (ctx.account) {
    await recordOrgEvent(prisma, {
      scope: "brand", entityId, departmentId: "platform", action, result: "denied", note: reason,
      actor: { kind: ctx.account.kind, id: ctx.account.id, name: ctx.account.name, role: ctx.account.role },
    }).catch(() => {});
  }
  return fail(reason);
}

/** **الإصدارُ المفتوح للمراجعة وعناصرُه** — يُنشأ أوّلَ مرّة من السجل، وتُحدَّث بصماتُ العناصر إن تغيّرت (دون مسّ حالاتها) */
export async function ensureBrandVersion(ctx: BrandCtx) {
  if (!ctx.canView || !ctx.account) return null;
  let v = await prisma.brandVersion.findFirst({ where: { version: BRAND_VERSION.number } });
  if (!v) {
    v = await prisma.brandVersion
      .create({ data: { version: BRAND_VERSION.number, name: BRAND_VERSION.label, summary: "الهوية الرسمية المعتمدة من حزمة «هوية تلاق 2026»", createdByName: ctx.account.name } })
      .catch(async () => (await prisma.brandVersion.findFirstOrThrow({ where: { version: BRAND_VERSION.number } })));
    await prisma.brandReviewEvent.create({ data: { versionId: v.id, action: "version.create", actorId: ctx.account.id, actorName: ctx.account.name, actorRole: ctx.account.role, note: v.name } }).catch(() => {});
  }
  const existing = await prisma.brandItem.findMany({ where: { versionId: v.id }, select: { id: true, key: true, contentHash: true } });
  for (const def of BRAND_ITEMS) {
    const hash = await contentHashOf(def);
    const row = existing.find((e) => e.key === def.key);
    if (!row) {
      const created = await prisma.brandItem
        .create({ data: { versionId: v.id, key: def.key, kind: def.kind, titleAr: def.titleAr, usage: def.usage, contentHash: hash, createdByName: ctx.account.name } })
        .catch(() => null);
      if (created) await prisma.brandReviewEvent.create({ data: { versionId: v.id, itemId: created.id, action: "item.create", toStatus: "draft", revision: 1, actorId: ctx.account.id, actorName: ctx.account.name, actorRole: ctx.account.role } });
    } else if (row.contentHash !== hash) {
      await prisma.brandItem.update({ where: { id: row.id }, data: { contentHash: hash, titleAr: def.titleAr, usage: def.usage } });
    }
  }
  return v;
}

const FLOW: Record<string, { from: BrandItemStatus[]; to: BrandItemStatus; who: "prepare" | "approve"; note?: boolean }> = {
  submit: { from: ["draft"], to: "ready_for_review", who: "prepare" },
  start_review: { from: ["ready_for_review"], to: "pending_approval", who: "approve" },
  request_changes: { from: ["ready_for_review", "pending_approval", "approved"], to: "changes_requested", who: "approve", note: true },
  approve: { from: ["ready_for_review", "pending_approval"], to: "approved", who: "approve" },
  revise: { from: ["changes_requested"], to: "draft", who: "prepare", note: true },
  publish: { from: ["approved"], to: "published", who: "approve" },
};
export type BrandAction = keyof typeof FLOW;

export const ACTION_LABEL: Record<BrandAction | "comment", string> = {
  submit: "إرسال للمراجعة",
  start_review: "بدء المراجعة",
  request_changes: "طلب تعديل",
  approve: "اعتماد",
  revise: "إعادة الإعداد بعد التعديل",
  publish: "نشر",
  comment: "ملاحظة",
};

/** **انتقالُ عنصر** — الصلاحيةُ من القاعدة، والحالةُ محروسةٌ في الكتابة (لا قراران متزامنان)، والسجلُّ في المعاملة نفسها */
export async function transitionItem(ctx: BrandCtx, itemId: string, action: BrandAction, rawNote?: unknown): Promise<Ok> {
  const f = FLOW[action];
  if (!f) return fail("إجراءٌ غير معروف");
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (f.who === "approve" && !ctx.canApprove) return denied(ctx, `brand.${action}`, itemId, "اعتمادُ الهوية ونشرُها للمؤسس وحده");
  if (f.who === "prepare" && !ctx.canPrepare) return denied(ctx, `brand.${action}`, itemId, "إعدادُ عناصر الهوية لمن له صلاحيتُه");
  const note = String(rawNote ?? "").trim().slice(0, 2000) || null;
  if (f.note && (!note || note.length < 3)) return fail(action === "revise" ? "اكتب ما عُدِّل" : "اكتب الملاحظات المطلوبة");
  const item = await prisma.brandItem.findUnique({ where: { id: itemId } });
  if (!item) return fail("العنصر غير موجود");
  if (!f.from.includes(item.status)) return fail(`لا يُنفَّذ «${ACTION_LABEL[action]}» والعنصرُ «${STATUS_LABEL[item.status]}»`);
  const def = itemDef(item.key);
  if (!def) return fail("العنصر لم يعد في سجل المعاينات");
  const hash = await contentHashOf(def);
  if (action === "submit" && !def.email && def.kind === "email") return fail("لا معاينةَ لهذا العنصر بعد");
  if (action === "publish") {
    if (item.approvedHash !== hash) return fail("تغيّر العنصرُ بعد اعتماده — يُعاد للمراجعة ويُعتمد من جديد قبل النشر");
    if (!def.implemented) return fail("لم يُطبَّق العنصرُ في المنصة بعد — يُطبَّق بعد اعتماده ويُختبر، ثم يُنشر");
  }
  const now = new Date();
  const data: Prisma.BrandItemUpdateManyMutationInput = { status: f.to, contentHash: hash };
  if (action === "submit") Object.assign(data, { submittedByName: ctx.account.name, submittedAt: now });
  if (action === "approve") Object.assign(data, { approvedByName: ctx.account.name, approvedAt: now, approvedRevision: item.revision, approvedHash: hash });
  if (action === "request_changes") Object.assign(data, { approvedByName: null, approvedAt: null, approvedRevision: null, approvedHash: null });
  if (action === "revise") Object.assign(data, { revision: { increment: 1 } });
  if (action === "publish") Object.assign(data, { publishedByName: ctx.account.name, publishedAt: now });
  const acc = ctx.account;
  const ok = await prisma.$transaction(async (tx) => {
    const w = await tx.brandItem.updateMany({ where: { id: item.id, status: item.status, revision: item.revision }, data });
    if (!w.count) return false;
    await tx.brandReviewEvent.create({
      data: {
        versionId: item.versionId, itemId: item.id, action, fromStatus: item.status, toStatus: f.to,
        revision: action === "revise" ? item.revision + 1 : item.revision, actorId: acc.id, actorName: acc.name, actorRole: acc.role, note,
      },
    });
    if (f.who === "approve") {
      await recordOrgEvent(tx, {
        scope: "brand", entityId: item.id, departmentId: "platform", action: `brand.${action}`,
        actor: { kind: acc.kind, id: acc.id, name: acc.name, role: acc.role },
        before: { status: item.status, revision: item.revision }, after: { status: f.to, key: item.key, hash: hash.slice(0, 16) }, note,
      });
    }
    return true;
  });
  return ok ? { ok: true } : fail("تغيّرت حالةُ العنصر للتوّ — حدّث الصفحة");
}

/** ملاحظةٌ على عنصر — من المُعِدّ أو المؤسس، ولا تغيّر حالته */
export async function commentItem(ctx: BrandCtx, itemId: string, rawNote: unknown): Promise<Ok> {
  if (!ctx.account || !ctx.canView) return denied(ctx, "brand.comment", itemId, "لا صلاحيةَ لمركز الهوية");
  const note = String(rawNote ?? "").trim().slice(0, 2000);
  if (note.length < 2) return fail("اكتب الملاحظة");
  const item = await prisma.brandItem.findUnique({ where: { id: itemId }, select: { id: true, versionId: true, status: true, revision: true } });
  if (!item) return fail("العنصر غير موجود");
  await prisma.brandReviewEvent.create({
    data: { versionId: item.versionId, itemId: item.id, action: "comment", fromStatus: item.status, toStatus: item.status, revision: item.revision, actorId: ctx.account.id, actorName: ctx.account.name, actorRole: ctx.account.role, note },
  });
  return { ok: true };
}

/** **التفعيلُ الرسمي لإصدار الهوية** — للمؤسس، حين تُنشر عناصرُه كلُّها؛ ويتقاعد السارى السابق ويبقى */
export async function activateVersion(ctx: BrandCtx, versionId: string): Promise<Ok> {
  if (!ctx.account) return fail("سجّل الدخول أولاً");
  if (!ctx.canApprove) return denied(ctx, "brand.activate", versionId, "تفعيلُ الهوية الرسمية للمؤسس وحده");
  const v = await prisma.brandVersion.findUnique({ where: { id: versionId }, include: { items: { select: { status: true } } } });
  if (!v) return fail("الإصدار غير موجود");
  if (v.status !== "draft") return fail("الإصدارُ مفعَّلٌ أو متقاعد");
  const pending = v.items.filter((i) => i.status !== "published").length;
  if (pending) return fail(`لم يُنشر ${pending} عنصراً بعد — يُفعَّل الإصدار حين تُنشر عناصرُه كلُّها`);
  const acc = ctx.account;
  await prisma.$transaction(async (tx) => {
    await tx.brandVersion.updateMany({ where: { status: "active" }, data: { status: "retired", retiredAt: new Date() } });
    await tx.brandVersion.update({ where: { id: v.id }, data: { status: "active", activatedAt: new Date(), activatedByName: acc.name } });
    await tx.brandReviewEvent.create({ data: { versionId: v.id, action: "version.activate", fromStatus: "draft", toStatus: "active", actorId: acc.id, actorName: acc.name, actorRole: acc.role } });
    await recordOrgEvent(tx, { scope: "brand", entityId: v.id, departmentId: "platform", action: "brand.activate", actor: { kind: acc.kind, id: acc.id, name: acc.name, role: acc.role }, after: { version: v.version, name: v.name } });
  });
  return { ok: true };
}
