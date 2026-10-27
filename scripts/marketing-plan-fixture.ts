import { prisma } from "@/lib/prisma";
import type { MkActor } from "@/lib/marketing/access";
import { updateBrief } from "@/lib/marketing/campaigns";
import { updatePieceSchedule, completeKpis } from "@/lib/marketing/schedule";
import { saveDesignBrief, BRAND_DEFAULTS } from "@/lib/marketing/designBrief";
import { recordFinalCheck, FINAL_ITEMS } from "@/lib/marketing/review";

/** يُكمل خطةَ حملةِ فحصٍ قبل تقديمها — لفحوصٍ ليست الخطةُ موضوعَها.
 *
 *  **لماذا وُجد:** صار تقديمُ الخطة يُردّ إن نقصت (`plan_incomplete` — الوصفُ والنتائجُ والمؤشراتُ
 *  وطريقةُ القياس والمخاطرُ والتاريخان، ولكل قطعةٍ نوعُها وموضوعُها ورسالتُها وكاتبُها ومصمّمُها
 *  ومواعيدُها الأربعة). وفحوصُ الحوكمة والمهامّ القديمة كانت تقدّم خطةً من الموجز وحده، فتغيّر
 *  الشرطُ لا توقّعُها: هذا يملأ الناقصَ بالخدمات نفسها (`updateBrief`، `updatePieceSchedule`)
 *  بقيمٍ موسومةٍ بأنها للفحص، ولا يمسّ ما ملأه الفحصُ بنفسه — فما تفحصه تلك الفحوصُ باقٍ كما كان.
 *
 *  وكذلك موجزُ التصميم: صار رفعُ التصميم يُردّ قبل اكتماله (`brief_required`)، فيُكتب لكل قطعةٍ
 *  موجزٌ من قيم الهوية الرسمية (`BRAND_DEFAULTS`) إن لم يكتبه الفحص.
 *
 *  الكاتبُ والمصمّمُ أوّلُ من عُيّن في الحملة بالمسؤولية؛ فيُستدعى بعد تعيين الفريق. */
export async function completePlanForTest(actor: MkActor, campaignId: string, opts: { start?: Date } = {}) {
  const c = await prisma.marketingCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      members: { orderBy: { addedAt: "asc" }, include: { member: { select: { active: true, capabilities: true } } } },
      deliverables: { orderBy: { createdAt: "asc" } },
    },
  });
  const now = Date.now();
  const end = c.deadline ?? new Date(now + 14 * 86400_000);
  const start = c.startDate ?? opts.start ?? new Date(Math.min(now - 3600_000, end.getTime() - 86400_000));
  const r = await updateBrief(actor, campaignId, {
    name: c.name,
    description: c.description ?? "حملةُ فحص — وصفٌ للفحص",
    objective: c.objective ?? "هدفُ الفحص",
    outcomes: c.outcomes ?? "نتيجةٌ متوقّعة للفحص",
    audience: c.audience ?? "جمهورُ الفحص",
    audienceSegments: c.audienceSegments ?? undefined,
    keyMessage: c.keyMessage ?? "رسالةُ الفحص",
    channels: c.channels.length ? c.channels : ["instagram"],
    startDate: start,
    deadline: end,
    priority: c.priority,
    budgetAmount: c.budgetAmount ?? undefined,
    budgetNote: c.budgetNote ?? undefined,
    kpis: completeKpis(c.kpis).length ? completeKpis(c.kpis).map((k) => ({ ...k, unit: k.unit ?? undefined })) : [{ name: "الوصول", target: "1000", source: "Instagram Insights" }],
    measurement: c.measurement ?? "أرقامُ المنصة بعد أسبوع من النشر",
    references: c.references ?? undefined,
    risks: c.risks ?? "لا مخاطر معروفة (فحص)",
  });
  if (!r.ok) throw new Error(`completePlanForTest: brief ${r.code}`);

  const first = (role: "writer" | "designer") =>
    c.members.find((m) => m.role === role && m.member.active && m.member.capabilities.includes(role))?.memberId ?? null;
  const span = end.getTime() - start.getTime();
  const at = (f: number) => new Date(start.getTime() + Math.round(span * f));
  for (const d of c.deliverables) {
    const res = await updatePieceSchedule(actor, d.id, {
      contentType: d.contentType ?? "post",
      topic: d.topic ?? `موضوع ${d.title}`,
      message: d.message ?? c.keyMessage ?? "رسالةُ الفحص",
      writerId: d.writerId ?? first("writer"),
      designerId: d.designerId ?? first("designer"),
      contentDueAt: d.contentDueAt ?? at(0.2),
      designDueAt: d.designDueAt ?? at(0.4),
      reviewDueAt: d.reviewDueAt ?? at(0.6),
      publishAt: d.publishAt ?? at(0.8),
      publishBasis: d.publishBasis ?? "manual",
    });
    if (!res.ok) throw new Error(`completePlanForTest: piece ${d.title} ${res.code}`);
    if (await prisma.marketingDesignBrief.count({ where: { deliverableId: d.id } })) continue;
    const b = await saveDesignBrief(actor, d.id, {
      placement: "المنشور الرئيسي", outputType: "صورة ثابتة", headline: d.title, logoPosition: "أعلى اليمين", logoSize: "صغير",
      logoSafeMargin: "48px", fonts: BRAND_DEFAULTS.fonts, colors: BRAND_DEFAULTS.colors, background: "بيج الهوية", layout: "عنوانٌ ثم صورة",
      contrastNotes: "نصٌّ داكنٌ على خلفيةٍ فاتحة", direction: BRAND_DEFAULTS.direction, deliveryMethod: "رفعٌ في المنصة",
    });
    if (!b.ok) throw new Error(`completePlanForTest: brief ${d.title} ${b.code}`);
  }
}

/** فحصُ الناشر الأخير ناجحاً على الزوج الحالي — لفحوصٍ تسجّل النشر وليس الفحصُ الأخيرُ موضوعَها.
 *  **لماذا:** صار النشرُ يُردّ قبله (`final_check_missing`)؛ يُستدعى بعد اجتياز الجودة وقبل أي تسجيل نشر. */
export async function finalCheckForTest(publisher: MkActor, deliverableId: string) {
  const d = await prisma.marketingDeliverable.findUniqueOrThrow({ where: { id: deliverableId }, select: { currentContentVersionId: true, currentDesignVersionId: true } });
  const r = await recordFinalCheck(publisher, deliverableId, {
    contentVersionId: d.currentContentVersionId ?? "",
    designVersionId: d.currentDesignVersionId ?? "",
    items: FINAL_ITEMS.map((key) => ({ key, passed: true })),
  });
  if (!r.ok || !r.passed) throw new Error(`finalCheckForTest: ${r.ok ? "not passed" : r.code}`);
}
