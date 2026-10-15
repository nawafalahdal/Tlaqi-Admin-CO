import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { appendMemberEvent } from "@/lib/googleSheets";
import { checkExternalLink, type LinkSource } from "@/lib/externalLinks";
import {
  MAX_PLAN_FILE_BYTES,
  ALLOWED_PLAN_TYPES,
  INLINE_PLAN_TYPES,
} from "@/lib/planFormats";

/** مركزُ خطط تَـــلاقِ — نبذةٌ يقرؤها الجميع، وموادُّ مرتَّبةٌ تحتها.
 *
 *  **الصلاحية مقسومةٌ قسمةً واضحة:** القراءةُ لكل من يدخل المنصة —
 *  عضواً كان أو قائداً؛ والكتابةُ للمؤسس والمدير التنفيذي وحدهما. فهذه
 *  وثائقُ التوجّه لا وثائقُ قسم: من يكتبها هو من يملك القرار فيها.
 *
 *  **والترتيبُ رقمٌ محفوظ لا تاريخُ رفع.** الخطةُ تُقرأ بترتيبٍ مقصود:
 *  النبذةُ ثم الخطةُ العامة ثم الأهداف ثم ما دونها. ولو رُتِّبت
 *  بالأحدث لانقلبت كلّما رُفع ملفٌّ متأخّر، ولو رُتِّبت بالاسم لما
 *  أمكن تقديمُ ما يجب تقديمه. فالرقمُ بيد صاحبه، والتبديلُ مبادلةٌ
 *  ذرّيّةٌ في معاملةٍ واحدة.
 */

export {
  MAX_PLAN_FILE_BYTES,
  ALLOWED_PLAN_TYPES,
  humanSize,
  typeLabel,
} from "@/lib/planFormats";

/** من يكتب في المركز: المؤسس والمدير التنفيذي. */
export function canManagePlans(role: string) {
  return role === "super_admin" || role === "executive";
}

export type PlanDocView = {
  id: string;
  order: number;
  title: string;
  note: string | null;
  kind: "file" | "link";
  fileName: string | null;
  mimeType: string | null;
  byteSize: number | null;
  linkUrl: string | null;
  uploadedByName: string;
  createdAt: Date;
};

/** الحقولُ التي تُقرأ في القوائم — وليست `data` منها.
 *
 *  هذا أهمُّ سطرٍ في الملف: `select` صريحٌ يَحذف البايتات. ولو كُتبت
 *  القائمةُ بـ`findMany()` عارياً لَحُمِّلت كلُّ الملفّات في كل فتحة
 *  صفحة — وهو عطبٌ لا يُرى في التطوير بملفٍّ واحد، ويُسقِط الصفحة
 *  حين تصير عشرةً. */
const DOC_SELECT = {
  id: true,
  order: true,
  title: true,
  note: true,
  kind: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
  linkUrl: true,
  uploadedByName: true,
  createdAt: true,
} as const;

/** يقرأ المركز كاملاً: النبذةُ ثم المواد مرتَّبةً.
 *
 *  والنبذةُ تُقرأ ولا تُنشَأ هنا: صفحةٌ تُفتَح لا تكتب في القاعدة،
 *  والقراءةُ من قارئٍ بلا صلاحيةِ كتابةٍ يجب أن تبقى قراءة. فالغائبُ
 *  يُعاد افتراضاً في الذاكرة، ويُكتب الصفُّ أولَ مرّةٍ يُحرَّر فيها. */
export async function readPlanLibrary() {
  const [library, docs] = await Promise.all([
    prisma.planLibrary.findUnique({ where: { id: "main" } }),
    prisma.planDoc.findMany({ select: DOC_SELECT, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
  ]);

  return {
    heading: library?.heading?.trim() || "خطط تَـــلاقِ",
    intro: library?.intro ?? "",
    updatedByName: library?.updatedByName ?? null,
    updatedAt: library?.updatedAt ?? null,
    docs: docs as PlanDocView[],
  };
}

/** يحفظ النبذة والعنوان — للمؤسس والتنفيذي. */
export async function savePlanIntro(opts: {
  heading: string;
  intro: string;
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!canManagePlans(opts.session.user.role)) {
    return { ok: false, reason: "تحرير المركز للمؤسس والمدير التنفيذي" };
  }
  const heading = opts.heading.trim() || "خطط تَـــلاقِ";
  const intro = opts.intro.trim();
  if (intro.length > 8000) return { ok: false, reason: "النبذة أطول من ثمانية آلاف حرف" };

  const by = opts.session.user.name ?? "—";
  await prisma.planLibrary.upsert({
    where: { id: "main" },
    create: { id: "main", heading, intro, updatedByName: by },
    update: { heading, intro, updatedByName: by },
  });

  await appendMemberEvent({
    fullName: by,
    email: "",
    roleOrDepartment: "مركز الخطط",
    event: "تحديث نبذة مركز الخطط",
    details: `العنوان: ${heading} — طول النبذة: ${intro.length} حرفاً`,
    at: new Date(),
  });
  return { ok: true };
}

function nextOrder(max: number | null) {
  return (max ?? 0) + 1;
}

/** يضيف مادةً: ملفاً مرفوعاً أو رابطاً — وتُذيَّل آخرَ الترتيب.
 *
 *  والجديدُ يُذيَّل لا يُصدَّر: من يرفع يعرف عنوانَ مادته لا موضعَها،
 *  والموضعُ يُقرَّر بالترتيب بعدها. ولو صُدِّرت لانقلب أولُ المركز مع
 *  كل رفع. */
export async function addPlanDoc(opts: {
  title: string;
  note?: string | null;
  linkUrl?: string | null;
  file?: { name: string; type: string; bytes: Uint8Array } | null;
  session: Session;
}): Promise<{ ok: true; id: string; title: string } | { ok: false; reason: string }> {
  if (!canManagePlans(opts.session.user.role)) {
    return { ok: false, reason: "الإضافة إلى المركز للمؤسس والمدير التنفيذي" };
  }

  const title = opts.title.trim();
  const note = opts.note?.trim() || null;
  if (!title) return { ok: false, reason: "عنوان المادة مطلوب" };

  const link = opts.linkUrl?.trim() || null;
  const file = opts.file && opts.file.bytes.byteLength > 0 ? opts.file : null;

  if (!file && !link) return { ok: false, reason: "ارفع ملفاً أو ضع رابطاً — لا تُضاف مادةٌ فارغة" };
  if (file && link) {
    return { ok: false, reason: "ملفٌّ أو رابطٌ لا كلاهما — فالمادةُ الواحدة لها مصدرٌ واحد" };
  }

  // الرابطُ يمرّ بقائمة السماح — انظر `@/lib/externalLinks`.
  //
  // وكان الحرسُ هنا `https` وحده، وهو يَمنع `javascript:` و`data:` ولا
  // يَمنع نطاقاً يُشبه درايف يَسوق الناسَ إلى صفحةِ تصيُّد. فصار
  // النطاقُ مفحوصاً بالتحليل: درايفُ ومستنداتُ جوجل وكانفا — لا ميت،
  // فالاجتماعُ ليس وثيقةً في مركز خطط.
  let checkedLink: string | null = null;
  if (link) {
    const checked = checkExternalLink(link, PLAN_LINK_SOURCES);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    checkedLink = checked.url;
  }

  if (file) {
    if (!ALLOWED_PLAN_TYPES[file.type]) {
      return {
        ok: false,
        reason: `نوعُ الملف غير مقبول (${file.type || "غير معروف"}) — المقبول: ${Object.values(
          ALLOWED_PLAN_TYPES
        ).join("، ")}`,
      };
    }
    if (file.bytes.byteLength > MAX_PLAN_FILE_BYTES) {
      return {
        ok: false,
        reason: `حجم الملف ${(file.bytes.byteLength / 1048576).toFixed(1)}MB — والحدّ ${(
          MAX_PLAN_FILE_BYTES / 1048576
        ).toFixed(0)}MB. ضعه في رابطٍ خارجيٍّ بدل رفعه.`,
      };
    }
  }

  const max = await prisma.planDoc.aggregate({ _max: { order: true } });
  const doc = await prisma.planDoc.create({
    data: {
      order: nextOrder(max._max.order),
      title,
      note,
      kind: file ? "file" : "link",
      fileName: file?.name ?? null,
      mimeType: file?.type ?? null,
      byteSize: file ? file.bytes.byteLength : null,
      data: file ? Buffer.from(file.bytes) : null,
      linkUrl: checkedLink,
      uploadedById: opts.session.user.id,
      uploadedByName: opts.session.user.name ?? "—",
    },
    select: { id: true, title: true, order: true },
  });

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: "مركز الخطط",
    event: file ? "رفع ملف إلى مركز الخطط" : "إضافة رابط إلى مركز الخطط",
    details: `${title} — الترتيب: ${doc.order}${
      file ? ` — ${file.name} (${(file.bytes.byteLength / 1024).toFixed(0)}KB)` : ` — ${link}`
    }`,
    at: new Date(),
  });

  return { ok: true, id: doc.id, title: doc.title };
}

/** يُعدّل عنوان المادة ووصفَها — لا مصدرَها. */
export async function renamePlanDoc(opts: {
  id: string;
  title: string;
  note?: string | null;
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!canManagePlans(opts.session.user.role)) {
    return { ok: false, reason: "التعديل للمؤسس والمدير التنفيذي" };
  }
  const title = opts.title.trim();
  if (!title) return { ok: false, reason: "العنوان مطلوب" };
  await prisma.planDoc.update({
    where: { id: opts.id },
    data: { title, note: opts.note?.trim() || null },
  });
  return { ok: true };
}

/** يُبدّل موضعَ مادةٍ بجارتها — مبادلةٌ ذرّيّةٌ لا كتابةُ رقمٍ مطلق.
 *
 *  **والمبادلةُ في معاملةٍ واحدة** لأن الرقم مشتركٌ بين صفَّين: لو
 *  كُتب أحدُهما ثم انقطع الاتصال لبقي رقمان متساويان — وترتيبٌ فيه
 *  رقمان متساويان ترتيبٌ يتبدّل مع كل قراءة. */
export async function movePlanDoc(opts: {
  id: string;
  direction: "up" | "down";
  session: Session;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!canManagePlans(opts.session.user.role)) {
    return { ok: false, reason: "الترتيب للمؤسس والمدير التنفيذي" };
  }
  const doc = await prisma.planDoc.findUnique({
    where: { id: opts.id },
    select: { id: true, order: true },
  });
  if (!doc) return { ok: false, reason: "المادة غير موجودة" };

  const neighbour = await prisma.planDoc.findFirst({
    where:
      opts.direction === "up" ? { order: { lt: doc.order } } : { order: { gt: doc.order } },
    orderBy: { order: opts.direction === "up" ? "desc" : "asc" },
    select: { id: true, order: true },
  });
  if (!neighbour) {
    return { ok: false, reason: opts.direction === "up" ? "هي الأولى بالفعل" : "هي الأخيرة بالفعل" };
  }

  await prisma.$transaction([
    prisma.planDoc.update({ where: { id: doc.id }, data: { order: neighbour.order } }),
    prisma.planDoc.update({ where: { id: neighbour.id }, data: { order: doc.order } }),
  ]);
  return { ok: true };
}

/** يحذف مادةً — ويُكتَب في السجل قبل أن تزول */
export async function removePlanDoc(opts: {
  id: string;
  session: Session;
}): Promise<{ ok: true; title: string } | { ok: false; reason: string }> {
  if (!canManagePlans(opts.session.user.role)) {
    return { ok: false, reason: "الحذف للمؤسس والمدير التنفيذي" };
  }
  const doc = await prisma.planDoc.findUnique({
    where: { id: opts.id },
    select: { id: true, title: true, kind: true, fileName: true, linkUrl: true },
  });
  if (!doc) return { ok: false, reason: "المادة غير موجودة" };

  await appendMemberEvent({
    fullName: opts.session.user.name ?? "—",
    email: "",
    roleOrDepartment: "مركز الخطط",
    event: "حذف مادة من مركز الخطط",
    details: `${doc.title} — ${doc.kind === "file" ? doc.fileName ?? "ملف" : doc.linkUrl ?? "رابط"}`,
    at: new Date(),
  });

  await prisma.planDoc.delete({ where: { id: doc.id } });
  return { ok: true, title: doc.title };
}

/** بايتاتُ ملفٍّ واحد — لمسار التنزيل وحده، وهو الموضع الوحيد الذي
 *  تُقرأ فيه `data`. */
export async function planDocFile(id: string) {
  const doc = await prisma.planDoc.findUnique({
    where: { id },
    select: { fileName: true, mimeType: true, data: true, kind: true },
  });
  if (!doc || doc.kind !== "file" || !doc.data || !doc.mimeType) return null;
  if (!ALLOWED_PLAN_TYPES[doc.mimeType]) return null;
  return {
    fileName: doc.fileName ?? "tlaqi-document",
    mimeType: doc.mimeType,
    bytes: Buffer.from(doc.data),
    inline: INLINE_PLAN_TYPES.has(doc.mimeType),
  };
}

/** ما أُضيف حديثاً — يُقال في تنبيهات الصفحة الرئيسية.
 *
 *  والحداثةُ تُقاس بأيامٍ لا بزيارةٍ أخيرة: تتبّعُ «آخر زيارةٍ لكل
 *  شخص» صفٌّ يُكتب في كل فتحةِ صفحة لكل عضو — كتابةٌ دائمةٌ ثمنُها
 *  أكبر من فائدتها هنا. */
export async function recentPlanDocs(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  return prisma.planDoc.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

/** عدّا المركز: كم فيه، وكم جَدَّ هذا الأسبوع.
 *
 *  وهما هنا لا في الصفحات: `Date.now()` داخل جسم مكوّنٍ نداءٌ غيرُ نقيٍّ
 *  يرفضه فحصُ القواعد — ومحلُّ حساب الوقت طبقةُ البيانات أصلاً، لا
 *  طبقةُ العرض. */
export async function planCounts(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, fresh] = await Promise.all([
    prisma.planDoc.count(),
    prisma.planDoc.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { total, fresh };
}

/** مصادرُ مركز الخطط: وثائقُ وتصاميمُ — لا اجتماعات.
 *
 *  والاجتماعُ له موضعُه في الإعلانات والتقويم، ومادةٌ في مركزِ خططٍ
 *  تَقود إلى غرفةِ اجتماعٍ انتهت تُقرأ عطباً. */
export const PLAN_LINK_SOURCES: readonly LinkSource[] = ["drive", "docs", "canva"];
