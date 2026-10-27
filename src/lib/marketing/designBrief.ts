import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAND } from "@/lib/brand";
import { campaignAccess, requireCampaignRole, type MkActor } from "./access";
import { logEvent } from "./audit";
import { deliverableFacts } from "./deliverables";
import { abort, fail, guarded, type MkResult } from "./result";

/** موجزُ التصميم — شرطُ بدء التصميم، يُفرض في الخادم.
 *
 *  لا يُرفع تصميمٌ ولا يُفتح شاتُ المصمّم قبل اكتماله (`uploadDesign`، `chatRules.ts`).
 *  والموجزُ لا يكرّر ما هو محفوظٌ في موضعه: **المقاسُ** من المخرج نفسه، و**النصُّ المعتمد** من
 *  نسخته الحاليّة المعتمدة، و**المصمّمُ وموعدُ التسليم** من تقويم القطعة.
 *
 *  **والهويةُ من مصادرها الرسمية وحدها:** الألوانُ من `BRAND` (`src/lib/brand.ts`)، والخطُّ خطُّ
 *  المنصة (Cairo — `src/app/layout.tsx`)، والشعارُ ملفّاتُه الأصلية في `public/brand/`. تُقترح
 *  قيماً أولى ولا يُخترع غيرُها، ولا يُعاد رسمُ الشعار. ورابطُ Canva أو الملفّ الخارجيّ يُحفظ
 *  رابطاً ولا يُدّعى فحصُه. */

type Tx = Prisma.TransactionClient;

export const BRIEF_REQUIRED = [
  "placement", "outputType", "headline", "logoPosition", "logoSize", "logoSafeMargin", "fonts", "colors",
  "background", "layout", "contrastNotes", "direction", "deliveryMethod",
] as const;
export const BRIEF_OPTIONAL = ["secondaryText", "cta", "imagery", "visualReferences", "externalLink"] as const;
type BriefField = (typeof BRIEF_REQUIRED)[number] | (typeof BRIEF_OPTIONAL)[number];
export type BriefInput = Partial<Record<BriefField, string>>;

/** ملفّاتُ الهوية الأصلية كما تستعملها المنصة — للتحميل، لا لإعادة الرسم */
export const OFFICIAL_LOGO_FILES = ["/brand/logo-full.png", "/brand/lockup-on-light.png", "/brand/lockup-on-dark.png", "/brand/symbol.png"] as const;

/** قيمٌ أولى من المصادر الرسمية — تُعرض في النموذج ليعتمدها من يكتب الموجز أو يغيّرها */
export const BRAND_DEFAULTS = {
  fonts: "Cairo — خطُّ المنصة الرسمي",
  colors: `Temptress ${BRAND.temptress} · Mahogany ${BRAND.mahogany} · Beige ${BRAND.beige} · Green Sheen ${BRAND.greenSheen}`,
  direction: "rtl",
} as const;

const LIMIT = 1000;
const clip = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, LIMIT) || null : null);

function validLink(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** ما ينقص الموجزَ ليبدأ التصميم — فارغةٌ = مكتمل */
export async function briefGaps(db: Tx | typeof prisma, deliverableId: string): Promise<string[]> {
  const d = await db.marketingDeliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    select: { designerId: true, designDueAt: true, designBrief: true },
  });
  const gaps: string[] = [];
  const b = d.designBrief;
  for (const f of BRIEF_REQUIRED) if (!b?.[f]) gaps.push(f);
  if (!d.designerId) gaps.push("designerId");
  if (!d.designDueAt) gaps.push("designDueAt");
  const facts = await deliverableFacts(db, deliverableId);
  if (!facts.contentApproved) gaps.push("approvedText");
  return gaps;
}

/** يكتب الموجز — المنسّقُ أو المصمّمُ في الحملة، والحملةُ غيرُ مغلقة والقطعةُ غيرُ منشورة.
 *  تعديلُه بعد رفع تصميمٍ لا يُسقط التصميمَ تلقائياً، لكنه يُسجَّل؛ ومراجعُ الجودة يقارن بالحاليّ. */
export async function saveDesignBrief(actor: MkActor, deliverableId: string, input: BriefInput): Promise<MkResult<{ gaps: string[] }>> {
  return guarded(async () => {
    const head = await prisma.marketingDeliverable.findUnique({ where: { id: deliverableId }, select: { campaignId: true } });
    if (!head) return fail("not_found");
    const access = await campaignAccess(actor, head.campaignId);
    if (!access.canView) return fail("not_found");
    if (!access.roles.has("coordinator") && !access.roles.has("designer")) return fail("forbidden", { role: "designer" });
    const role = access.roles.has("coordinator") ? "coordinator" : "designer";
    await requireCampaignRole(actor, head.campaignId, role);
    const externalLink = input.externalLink ? validLink(clip(input.externalLink)) : null;
    if (input.externalLink && !externalLink) return fail("url_invalid");
    const direction = clip(input.direction);
    if (direction && direction !== "rtl" && direction !== "ltr") return fail("invalid_input", { field: "direction" });
    return prisma.$transaction(async (tx) => {
      const d = await tx.marketingDeliverable.findUniqueOrThrow({ where: { id: deliverableId }, select: { status: true, campaign: { select: { status: true } } } });
      if (d.status === "published") abort("invalid_state", { from: d.status });
      if (d.campaign.status === "archived" || d.campaign.status === "published") abort("campaign_closed", { status: d.campaign.status });
      const data = {
        ...Object.fromEntries([...BRIEF_REQUIRED, ...BRIEF_OPTIONAL].filter((f) => f !== "externalLink" && f !== "direction").map((f) => [f, clip(input[f])])),
        direction,
        externalLink,
        updatedByName: actor.name,
      };
      await tx.marketingDesignBrief.upsert({
        where: { deliverableId },
        create: { deliverableId, ...data },
        update: { ...data, revision: { increment: 1 } },
      });
      await logEvent(tx, actor, { action: "brief.updated", campaignId: head.campaignId, deliverableId });
      return { ok: true as const, gaps: await briefGaps(tx, deliverableId) };
    });
  });
}

/** شرطُ التصميم داخل معاملة الرفع: الموجزُ مكتمل، وإلا أُلغيت العملية بما نقص */
export async function requireBriefComplete(tx: Tx, deliverableId: string) {
  const gaps = await briefGaps(tx, deliverableId);
  if (gaps.length) abort("brief_required", { missing: gaps.join(",") });
}
