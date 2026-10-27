import { prisma } from "@/lib/prisma";
import { campaignAccess, type MkActor } from "../access";
import { logEvent } from "../audit";
import { extractBlock } from "../chatRules";
import { saveDraft } from "../content";
import { setDesignDescription } from "../design";
import { fail, guarded, type MkResult } from "../result";

/** **نقلُ ردّ المساعد إلى صفحته** — النصُّ إلى مسودة المحتوى، ووصفُ التصميم إلى صفحة التصميم، بضغطة
 *  بدل النسخ اليدوي. والنقلُ فعلُ صاحب المهمّة نفسه بحرسها هو:
 *
 *  - الردُّ مكتملٌ (`done`) من محادثةٍ يقرؤها صاحبُ الطلب، وعلى المنشور نفسه الذي في سياقها.
 *  - المسودةُ عبر `saveDraft` (الكاتبُ في الحملة، والمنشورُ قيد العمل)، والوصفُ عبر
 *    `setDesignDescription` (المنسّقُ أو المصمّم، قبل النشر). فلا يتجاوز النقلُ صلاحيةً لا يملكها.
 *  - **يُضاف ولا يُستبدل:** النصُّ يُلحق بالمسودة تحت فاصل، فلا يضيع ما كتبه الكاتب.
 *  - **ولا يعتمد ولا يقدّم ولا ينشر:** المسودةُ مسودة، والتقديمُ للمراجعة بيد الكاتب بعد ذلك. */
export async function transferFromChat(actor: MkActor, replyId: string, target: "draft" | "design", deliverableId: string): Promise<MkResult> {
  return guarded(async () => {
    const r = await prisma.marketingChatMessage.findUnique({
      where: { id: replyId },
      select: { role: true, status: true, body: true, thread: { select: { kind: true, campaignId: true, deliverableId: true, ownerId: true } } },
    });
    if (!r || r.role !== "assistant") return fail("not_found");
    if (r.status !== "done" || !r.body.trim()) return fail("invalid_state", { from: r.status });
    const t = r.thread;
    // يقرأ المحادثة: مساعدُه هو، أو محادثةُ مهمّةٍ في حملةٍ يرى عملَها
    if (t.kind === "assistant" ? t.ownerId !== actor.member?.id : !t.campaignId || !(await campaignAccess(actor, t.campaignId)).canView) return fail("not_found");
    // على المنشور الذي في سياقها وحده
    if (!t.deliverableId || t.deliverableId !== deliverableId) return fail("invalid_input", { field: "deliverable" });

    const text = extractBlock(r.body, target === "draft" ? "text" : "design").slice(0, 8000);
    if (!text) return fail("invalid_input", { field: "body" });
    let res: MkResult;
    if (target === "draft") {
      const d = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { contentDraft: true } });
      if (!d) return fail("not_found");
      res = await saveDraft(actor, deliverableId, d.contentDraft.trim() ? `${d.contentDraft.trimEnd()}\n\n———\n${text}` : text);
    } else {
      res = await setDesignDescription(actor, deliverableId, text);
    }
    if (!res.ok) return res;
    if (t.campaignId) await logEvent(prisma, actor, { action: "chat.transferred", campaignId: t.campaignId, deliverableId, details: { target, kind: t.kind, chars: text.length } });
    return { ok: true };
  });
}
