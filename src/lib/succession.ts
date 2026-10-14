import { prisma } from "@/lib/prisma";
import { accountRoleLabel } from "@/lib/testTracks";
import { appendMemberEvent } from "@/lib/googleSheets";

/** الخلافة — المنصب يبقى حين يذهب شاغلُه.
 *
 *  **الهيكل نفسه لا يحتاج نقلاً.** هو يُحسَب من المناصب والأقسام لا
 *  يُخزَّن: «الرئيس التنفيذي» هو الحسابُ النشط صاحبُ الصفة، و«قائد
 *  التسويق» هو النشطُ المصنَّف في التسويق بصفة قائد. فمن تنحّى زال من
 *  الحساب، ومن عُيِّن ظهر مكانه بقادته وأقسامه وأعضائه في القراءة
 *  التالية — بلا نقلٍ يدويٍّ ولا زرٍّ يُضغط. والأعضاء يتبعون أقسامهم لا
 *  أشخاصهم، فلا يتيتّم أحدٌ بذهاب قائده.
 *
 *  **وما يحتاج نقلاً هو العمل المعلَّق باسمه**: دعوةٌ أرسلها، وطلبُ
 *  اعتمادٍ ينتظر توقيعه، وتذكرةٌ وُجِّهت إليه، وطلبُ إنهاءٍ ينتظر قراره.
 *  هذه مربوطةٌ بصفِّه هو لا بمنصبه، فلو ذهب بلا نقلٍ لبقيت معلّقةً إلى
 *  الأبد: طلبٌ معتمِدُه محذوف لا يملك أحدٌ البتَّ فيه.
 *
 *  **وهذا أيضاً سببُ «حدث خطأ غير متوقّع» عند الحذف.** الدعوة تحمل
 *  `invitedById` إلزامياً، فصفُّ من أرسلها لا يُحذف ما دامت قائمة —
 *  تَرفض القاعدة الحذف، ويسقط الإجراء بخطأٍ عام لا يقول شيئاً. فالنقل
 *  شرطُ الحذف لا تحسينٌ بعده.
 */

export type Successor = { id: string; fullName: string; roleLabel: string } | null;

/** من يرث العملَ المعلَّق: أقربُ من يملك القرار نفسه.
 *
 *  والترتيب يتبع سلسلة التصعيد المعتمدة في المنصة: قائدُ القسم يرثه
 *  قائدٌ آخر لقسمه إن وُجد، ثم التنفيذي، ثم المؤسس. والتنفيذيُّ يرثه
 *  تنفيذيٌّ آخر ثم المؤسس. والمؤسس لا يُورَّث — حسابُه لا يُحذف أصلاً.
 */
export async function successorFor(user: {
  id: string;
  role: string;
  departmentId: string | null;
}): Promise<Successor> {
  const pick = async (where: Record<string, unknown>) =>
    prisma.user.findFirst({
      where: { isActive: true, id: { not: user.id }, ...where },
      select: { id: true, fullName: true, role: true },
      orderBy: { createdAt: "asc" },
    });

  const chain: Record<string, unknown>[] = [];
  if (user.role === "department_admin" && user.departmentId) {
    chain.push({ role: "department_admin", departmentId: user.departmentId });
  }
  if (user.role !== "executive") chain.push({ role: "executive" });
  else chain.push({ role: "executive" });
  chain.push({ role: "super_admin" });

  for (const where of chain) {
    const found = await pick(where);
    if (found) {
      return { id: found.id, fullName: found.fullName, roleLabel: accountRoleLabel(found.role) };
    }
  }
  return null;
}

export type TransferCounts = {
  invites: number;
  approvals: number;
  approvalChains: number;
  tickets: number;
  terminations: number;
};

export function transferredAnything(c: TransferCounts): boolean {
  return c.invites + c.approvals + c.approvalChains + c.tickets + c.terminations > 0;
}

/** يصف ما انتقل بالعربية — ليُقال للمؤسس لا ليُخمَّن */
export function describeTransfer(c: TransferCounts, toName: string): string {
  const parts: string[] = [];
  if (c.invites) parts.push(`${c.invites} دعوة`);
  if (c.approvals) parts.push(`${c.approvals} طلب اعتماد`);
  if (c.approvalChains) parts.push(`${c.approvalChains} مسار اعتماد`);
  if (c.tickets) parts.push(`${c.tickets} تذكرة مفتوحة`);
  if (c.terminations) parts.push(`${c.terminations} طلب إنهاء`);
  return parts.length === 0 ? "لا عمل معلَّق باسمه" : `انتقل إلى ${toName}: ${parts.join("، ")}`;
}

/** ينقل العملَ المعلَّق من حسابٍ إلى خَلَفِه.
 *
 *  ولا يُنقَل المُنجَز: التذكرةُ المُغلقة والطلبُ المعتمَد يبقيان باسم
 *  من فعلهما — نقلُ التاريخ تزوير. والمنقول هو ما ينتظر فعلاً.
 *
 *  **ولا يُنقَل طلبٌ إلى صاحبه.** لو كان الخَلَفُ هو رافعَ الطلب لصار
 *  يعتمد نفسه، وذلك ممنوعٌ في المحرّك أصلاً — فيُرفَع إلى المؤسس.
 */
export async function transferResponsibilities(opts: {
  fromUserId: string;
  toUserId: string;
  /** يُكتب في سجلّ القرارات ليُقرأ أن الانتقال خلافةٌ لا قرار */
  byName: string;
}): Promise<TransferCounts> {
  const { fromUserId, toUserId } = opts;

  // ── الدعوات: تُنقَل كاملةً. وهي القيدُ الذي يمنع حذف الصفّ أصلاً،
  //    والدعوة بلا مُرسِلٍ لا تصحّ — فلا تُحذف ولا تُفَكّ، بل تُورَّث.
  const invites = await prisma.invite.updateMany({
    where: { invitedById: fromUserId },
    data: { invitedById: toUserId },
  });

  // ── طلبات الاعتماد المفتوحة التي ينتظرها
  const open = await prisma.ticket.findMany({
    where: { approverUserId: fromUserId, approvalState: { in: ["awaiting", "reviewing"] } },
    select: { id: true, raisedByUserId: true, approvalStep: true },
  });
  let approvals = 0;
  for (const t of open) {
    // الخَلَفُ لا يعتمد طلبَ نفسه — فيُرفَع إلى المؤسس
    let heir = toUserId;
    if (t.raisedByUserId === toUserId) {
      const founder = await prisma.user.findFirst({
        where: { role: "super_admin", isActive: true, id: { not: toUserId } },
        select: { id: true },
      });
      if (!founder) continue;
      heir = founder.id;
    }
    const moved = await prisma.ticket.updateMany({
      where: { id: t.id, approverUserId: fromUserId },
      data: { approverUserId: heir },
    });
    if (moved.count > 0) {
      approvals += 1;
      // السجلّ يُقال فيه ما جرى: انتقالٌ بالخلافة، لا قرارٌ في الطلب
      await prisma.approvalDecision.create({
        data: {
          ticketId: t.id,
          deciderId: null,
          deciderName: opts.byName,
          decision: "awaiting",
          note: "انتقل الطلب إلى خَلَف المعتمِد — ولم يُبَتّ فيه بعد",
          step: t.approvalStep,
        },
      });
    }
  }

  // ── مسارات الاعتماد المتسلسلة: اسمُه فيها يُستبدَل باسم خَلَفِه،
  //    وإلا وقف الطلب عند مرحلةٍ معتمِدُها غير موجود
  const chained = await prisma.ticket.findMany({
    where: { approvalChain: { has: fromUserId } },
    select: { id: true, approvalChain: true },
  });
  let approvalChains = 0;
  for (const t of chained) {
    const next = t.approvalChain.map((id) => (id === fromUserId ? toUserId : id));
    // ولا يتكرّر معتمِدٌ في المسار: لو صار الخَلَفُ مرّتين اكتفى بواحدة
    const deduped = next.filter((id, i) => next.indexOf(id) === i);
    await prisma.ticket.update({ where: { id: t.id }, data: { approvalChain: deduped } });
    approvalChains += 1;
  }

  // ── التذاكر المفتوحة الموجَّهة إليه: تُعاد توجيهاً لا تُفَكّ.
  //    وتذكرةٌ بلا وجهة تسقط من كل قائمةٍ ولا يراها أحد.
  const tickets = await prisma.ticket.updateMany({
    where: { targetUserId: fromUserId, status: { not: "resolved" } },
    data: { targetUserId: toUserId },
  });

  // ── طلبات الإنهاء التي تنتظر قراره
  const terminations = await prisma.terminationRequest.updateMany({
    where: { decidedById: fromUserId, status: { in: ["submitted", "meeting_requested"] } },
    data: { decidedById: toUserId },
  });

  return {
    invites: invites.count,
    approvals,
    approvalChains,
    tickets: tickets.count,
    terminations: terminations.count,
  };
}

/** ينقل ويُسجّل — الوجهُ الذي تستعمله التنحية والحذف معاً. */
export async function handOver(opts: {
  user: { id: string; fullName: string; email: string; role: string; departmentId: string | null };
  byName: string;
  occasion: "تنحية" | "حذف نهائي";
}): Promise<{ successor: Successor; counts: TransferCounts; summary: string }> {
  const successor = await successorFor(opts.user);
  if (!successor) {
    const empty: TransferCounts = {
      invites: 0, approvals: 0, approvalChains: 0, tickets: 0, terminations: 0,
    };
    return { successor: null, counts: empty, summary: "لا خَلَفَ نشطاً يرث العمل المعلَّق" };
  }

  const counts = await transferResponsibilities({
    fromUserId: opts.user.id,
    toUserId: successor.id,
    byName: opts.byName,
  });
  const summary = describeTransfer(counts, `${successor.fullName} (${successor.roleLabel})`);

  if (transferredAnything(counts)) {
    await appendMemberEvent({
      fullName: opts.user.fullName,
      email: opts.user.email,
      event: `خلافة عند ${opts.occasion}`,
      roleOrDepartment: accountRoleLabel(opts.user.role),
      details: `${summary}. والمنصب نفسه لا يُنقَل: الهيكل يُحسَب من المناصب، فمن عُيِّن بعده ورثه بقادته وأقسامه وأعضائه.`,
      at: new Date(),
    });
  }

  return { successor, counts, summary };
}
