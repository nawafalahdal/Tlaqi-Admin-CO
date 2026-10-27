import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { campaignAccess, type MkActor } from "./access";
import { logEvent, logSystemEvent } from "./audit";
import { POST_INCLUDE, iso, postRows, standardRow, storeOf, who, writeAndVerify, type ArchiveDeps, type ArchiveOutcome } from "./archive";
import { fail, guarded, type MkResult } from "./result";
import { backoffMs } from "./ai/jobs";

/** **أرشفةُ كل منشورٍ بعد نشره الفعلي** — المنصةُ للعمل الجاري، وملفُّ الأرشيف للسجلّ الدائم.
 *
 *    نشرٌ مؤكَّد (رابطٌ على منصته، ورآه الناشرُ حيّاً) ← طلبُ أرشفةٍ في المعاملة نفسها ← كتابةُ صفوفه
 *    ← قراءتُها من الملف ومطابقتُها ← وعندها وحدها يخرج المنشور من قوائم العمل (`archivedAt`)،
 *    ويُبلَّغ الفريقُ مرّةً واحدة: «تم نشر المنشور الأول في الحملة».
 *
 *  - **لا يُعدّ المنشورُ منشوراً باعتماده:** الطلبُ يُنشأ في معاملة `recordPublication` وحدها — بعد
 *    الفحص الأخير وتأكيد الناشر ورابطٍ على منصة المنشور نفسها.
 *  - **لا فقدَ ولا حذف عند الفشل:** تعذّرُ الملف أو مهلتُه أو صفٌّ لا يطابق — كلُّها تُبقي المنشورَ في
 *    «الاعتماد والنشر» بحالة «تعذّرت الأرشفة»، ويُعاد آلياً بتأخيرٍ متزايدٍ حتى ٨ محاولات، ثم بيد
 *    المنسّق أو الناشر. والبياناتُ لا تُحذف هنا أصلاً: تبقى حتى أرشفة الحملة كلِّها (التي تحذف بعد تحقّقها).
 *  - **لا تكرار:** لكل منشورٍ عمليةٌ واحدة (`deliverableId` فريد) بمعرّفٍ ثابت، وصفوفُه تُبنى مرّةً
 *    وتُحفظ (`rows`) فتُكتب في كل محاولةٍ بالقيم نفسها، وكلُّ محاولةٍ تُلحق الناقصَ وحده.
 *  - **لا ثقلَ على المنصة:** الكتابةُ بعد ردّ الطلب (`after()`) وفي الكنس اليومي — لا في عرض صفحة —
 *    وصفحاتُ العمل لا تقرأ الملفَّ أبداً. */

const LEASE_MS = 120_000;
const PA = () => prisma.marketingPostArchive;

/** يُطلب في معاملة تسجيل النشر نفسها — فلا نشرَ مؤكَّدٌ بلا أرشفةٍ مطلوبة، ولا طلبان لمنشورٍ واحد */
export async function queuePostArchive(tx: Prisma.TransactionClient, deliverableId: string, campaignId: string, now = new Date()) {
  const r = await tx.marketingPostArchive.upsert({ where: { deliverableId }, create: { deliverableId, campaignId, nextAttemptAt: now }, update: {}, select: { id: true } });
  return r.id;
}

/** خطوةُ أرشفةٍ واحدة لمنشور — تُستأنف من حيث وقفت */
export async function processPostArchive(id: string, deps?: ArchiveDeps): Promise<ArchiveOutcome> {
  const now = deps?.now?.() ?? new Date();
  const claimed = await PA().updateMany({
    where: {
      id,
      OR: [
        { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "writing", leaseUntil: { lt: now } },
      ],
    },
    data: { status: "writing", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count === 0) return "not_claimed";
  const pa = await PA().findUniqueOrThrow({ where: { id } });
  const ours = { id: pa.id, attempts: pa.attempts };
  const failWith = async (code: string, retryable: boolean): Promise<ArchiveOutcome> => {
    const final = !retryable || pa.attempts >= pa.maxAttempts;
    await PA().updateMany({
      where: { ...ours, status: "writing" },
      data: final
        ? { status: "failed", lastError: code, leaseUntil: null }
        : { status: "pending", lastError: code, leaseUntil: null, nextAttemptAt: new Date(now.getTime() + backoffMs(pa.attempts)) },
    });
    const live = await prisma.marketingDeliverable.count({ where: { id: pa.deliverableId } });
    await logSystemEvent(prisma, { action: "post_archive.failed", campaignId: live ? pa.campaignId : null, deliverableId: live ? pa.deliverableId : null, details: { postArchiveId: pa.id, error: code, attempts: pa.attempts, final } });
    return final ? "failed" : "retry_scheduled";
  };

  const d = await prisma.marketingDeliverable.findUnique({
    where: { id: pa.deliverableId },
    include: { ...POST_INCLUDE, campaign: { select: { id: true, name: true, startDate: true, deadline: true, ownerId: true } } },
  });
  if (!d) return failWith("post_missing", false);
  if (d.status !== "published" || d.publications.length === 0) return failWith("not_published", false);

  // الصفوفُ تُبنى مرّةً وتُحفظ قبل الكتابة — فكلُّ محاولةٍ تكتب القيمَ نفسها ولو تغيّر شيءٌ بعدها
  let rows = Array.isArray(pa.rows) ? (pa.rows as string[][]) : null;
  if (!rows) {
    try {
      const run = { id: pa.id, at: pa.createdAt };
      const pub = d.publications[d.publications.length - 1];
      rows = [
        ...postRows(d.campaign, d, run),
        standardRow(d.campaign, run)(`post_run:${pa.id}`, "post_run", {
          platform: d.platform, item: `أرشفة المنشور ${d.seq ?? "—"} «${d.title}»`, status: "طُلبت تلقائياً بعد النشر", actual: iso(pa.createdAt), person: who(pub.publisher),
        }, { postArchiveId: pa.id, deliverableId: d.id, publicationId: pub.id }),
      ];
    } catch {
      return failWith("rows_failed", true);
    }
    await PA().updateMany({ where: { ...ours, status: "writing" }, data: { rows, expectedRows: rows.length } });
  }

  const store = storeOf(deps);
  if (!store) return failWith("store_unavailable", true);
  const sheet = await writeAndVerify(store, d.campaignId, rows, { onlyExpectedKeys: true });
  if (!sheet.ok) return failWith(sheet.code, sheet.retryable);

  // تحقّقت الكتابة: يخرج من قوائم العمل، ويُبلَّغ الفريقُ مرّةً واحدة (إشعارٌ لكل عضوٍ لا يتكرّر)
  const members = await prisma.marketingCampaignMember.findMany({ where: { campaignId: d.campaignId, member: { active: true } }, select: { memberId: true } });
  const recipients = [...new Set([...members.map((m) => m.memberId), d.campaign.ownerId])];
  const pub = d.publications[d.publications.length - 1];
  await prisma.$transaction(async (tx) => {
    const done = await tx.marketingPostArchive.updateMany({
      where: { ...ours, status: "writing" },
      data: { status: "completed", verifiedRows: sheet.verified, completedAt: now, leaseUntil: null },
    });
    if (done.count === 0) return; // فقد حجزَه لعاملٍ آخر — ذاك يكمل
    await tx.marketingDeliverable.updateMany({ where: { id: d.id, archivedAt: null }, data: { archivedAt: now } });
    await tx.marketingNotice.createMany({
      data: recipients.map((memberId) => ({
        memberId, kind: "post_archived", campaignId: d.campaignId, deliverableId: d.id,
        params: { campaign: d.campaign.name, seq: d.seq ?? 0, title: d.title, url: pub.url },
      })),
      skipDuplicates: true,
    });
    await logSystemEvent(tx, { action: "post_archive.completed", campaignId: d.campaignId, deliverableId: d.id, details: { postArchiveId: pa.id, rows: rows!.length, appendedThisAttempt: sheet.appended } });
  });
  return "completed";
}

/** ما حان من أرشفة المنشورات — بعد الرد وفي الكنس المجدول، في حدود عددٍ ووقت */
export async function processDuePostArchives(opts: { limit?: number; budgetMs?: number; campaignId?: string } = {}, deps?: ArchiveDeps) {
  const started = Date.now();
  const now = deps?.now?.() ?? new Date();
  const due = await PA().findMany({
    where: {
      ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
      OR: [
        { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "writing", leaseUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(opts.limit ?? 5, 10),
    select: { id: true },
  });
  const out: ArchiveOutcome[] = [];
  for (const r of due) {
    if (Date.now() - started > (opts.budgetMs ?? 25_000)) break;
    out.push(await processPostArchive(r.id, deps));
  }
  return out;
}

/** منشورٌ نُشر قبل هذه الآلية (أو انقطع طلبُه) بلا طلب أرشفة — يُطلب له الآن. للكنس المجدول */
export async function enqueueMissingPostArchives(limit = 20, now = new Date(), campaignId?: string) {
  const missing = await prisma.marketingDeliverable.findMany({
    where: { status: "published", archivedAt: null, postArchive: null, ...(campaignId ? { campaignId } : {}) },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, campaignId: true },
  });
  for (const d of missing) await PA().upsert({ where: { deliverableId: d.id }, create: { deliverableId: d.id, campaignId: d.campaignId, nextAttemptAt: now }, update: {} });
  return missing.length;
}

/** إعادةٌ يدويةٌ لأرشفة منشورٍ فشلت نهائياً — المنسّقُ أو الناشرُ في الحملة */
export async function retryPostArchive(actor: MkActor, deliverableId: string): Promise<MkResult<{ postArchiveId: string }>> {
  return guarded(async () => {
    const pa = await PA().findUnique({ where: { deliverableId } });
    if (!pa) return fail("not_found");
    const access = await campaignAccess(actor, pa.campaignId);
    if (!access.canView) return fail("not_found");
    if (!access.roles.has("coordinator") && !access.roles.has("publisher")) return fail("forbidden", { role: "publisher" });
    if (pa.status !== "failed") return fail("invalid_state", { from: pa.status });
    const res = await PA().updateMany({ where: { id: pa.id, status: "failed" }, data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    if (!res.count) return fail("stale");
    await logEvent(prisma, actor, { action: "post_archive.retried", campaignId: pa.campaignId, deliverableId, details: { postArchiveId: pa.id } });
    return { ok: true, postArchiveId: pa.id };
  });
}

// ─── الإشعارات ───────────────────────────────────────────────────────

export type MkNotice = { id: string; kind: string; params: { campaign?: string; seq?: number; title?: string; url?: string }; createdAt: Date };

/** إشعاراتُ العضو التي لم تُعرض بعد — قراءةٌ بلا كتابة (تُعلَّم «مقروءة» من المتصفح بعد ظهورها) */
export async function unseenNotices(actor: MkActor, take = 5): Promise<MkNotice[]> {
  if (!actor.member) return [];
  const rows = await prisma.marketingNotice.findMany({
    where: { memberId: actor.member.id, seenAt: null },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, kind: true, params: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, params: (r.params ?? {}) as MkNotice["params"] }));
}

/** تُعلَّم مقروءةً لصاحبها وحده — فلا يظهر الإشعارُ مرّةً ثانية */
export async function markNoticesSeen(actor: MkActor, ids: string[]): Promise<number> {
  if (!actor.member || ids.length === 0) return 0;
  const r = await prisma.marketingNotice.updateMany({ where: { id: { in: ids.slice(0, 20) }, memberId: actor.member.id, seenAt: null }, data: { seenAt: new Date() } });
  return r.count;
}
