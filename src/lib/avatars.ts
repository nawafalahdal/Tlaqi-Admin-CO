import sharp from "sharp";
import type { Metadata } from "sharp";
import { prisma } from "@/lib/prisma";

/** الصور الشخصية — واحدةٌ معتمدة لكل شخص، تُوحَّد عند الاستلام.
 *
 *  **التوحيد عند الاستلام لا عند العرض.** الصورة تُقرأ في الهيكل
 *  التنظيمي وفي بطاقات كثيرة، فلو تُركت بأبعادها وحجمها الأصليين لاحتاج
 *  كل موضعٍ أن يُصلحها بنفسه: واحدةٌ ٤٠٠٠ بكسل تُثقل الصفحة، وأخرى
 *  مستطيلةٌ تُشوّه البطاقة. فتُصغَّر مرّةً واحدة إلى مربّعٍ موحّد، ثم
 *  تُعرض كما هي في كل مكان — والهيكل يبدو متناسقاً بلا جهدٍ في كل بطاقة.
 *
 *  **والشفافية تُحفَظ.** الطلب صورةٌ بخلفيةٍ شفّافة، فلا تُسطَّح على
 *  أبيض: التسطيح يضع مربّعاً أبيض حول كل رأسٍ في هيكلٍ ملوّن.
 *
 *  **والمخرَج WebP لا PNG — وهذا تغييرٌ أملاه القياس.** كان PNG، فقِستُ
 *  صورةً حقيقيةً في القاعدة: **٩٠٤ ك.ب** لمربّعٍ ٥١٢×٥١٢. وPNG صيغةٌ
 *  بلا فقدٍ وُضعت للرسوم لا للصور الفوتوغرافية، فهي تَحفظ كلَّ حبيبةِ
 *  ضوءٍ في الوجه بدقّةٍ لا تُرى على بطاقةٍ عرضُها ٧٢ بكسلاً. وقِستُ
 *  البدائل على الصورة نفسها: WebP بجودة ٨٢ يُعطي **١٩١ ك.ب** (٧٩٪
 *  أقلّ)، وAVIF يُعطي ١٠٤ ك.ب لكنّ ترميزَه أبطأُ ولا مكسبَ يُوازيه هنا.
 *  وWebP يَحمل قناةَ الشفافية كاملةً، فالشرطُ الأول محفوظ.
 *
 *  **والتحقّق بفكّ الصورة لا بامتدادها.** ملفٌّ اسمُه `.png` قد يكون أيَّ
 *  شيء، وعدُّ البايتات لا يقول إن فيه صورة. فتُفَكّ بـsharp: إن لم تُفَكّ
 *  فليست صورة، وإن فُكّت وكانت فارغةً فليست صورةً تُعرَض. وهذا الدرس
 *  نفسه الذي أُخِذ في توقيعات القادة.
 */

/** ضلع المربّع المعتمد — ٥١٢ يكفي للعرض على الشاشات المضاعَفة */
const SIDE = 512;
/** الحدّ الأعلى للمُدخَل: أكبر من هذا لا يُقرأ صورةً شخصية */
const MAX_INPUT_BYTES = 6 * 1024 * 1024;
/** الحدّ الأدنى للأبعاد: ما دون هذا لا يُعرَض بطاقةً */
const MIN_SIDE = 64;

export type AvatarSubject = { kind: "member" | "user"; id: string };

/** يتحقّق من الصورة ويُوحّدها، ويُعيد data URL جاهزاً للتخزين. */
export async function normalizeAvatar(
  input: Buffer
): Promise<{ ok: true; dataUrl: string; bytes: number } | { ok: false; reason: string }> {
  if (input.length === 0) return { ok: false, reason: "لم يُرفَع ملف" };
  if (input.length > MAX_INPUT_BYTES) {
    return { ok: false, reason: "حجم الصورة يتجاوز ٦ ميجابايت" };
  }

  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { ok: false, reason: "الملف ليس صورةً يمكن قراءتها" };
  }

  // الصيغ المقبولة: ما يحمل شفافيةً أو يُحوَّل إليها بأمان
  const format = meta.format ?? "";
  if (!["png", "jpeg", "webp", "avif"].includes(format)) {
    return { ok: false, reason: `صيغة غير مدعومة (${format || "مجهولة"}) — استخدم PNG` };
  }

  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < MIN_SIDE || h < MIN_SIDE) {
    return { ok: false, reason: `الصورة صغيرة جداً (${w}×${h}) — الحدّ ${MIN_SIDE}×${MIN_SIDE}` };
  }

  // مربّعٌ موحّد بخلفيةٍ شفّافة: `contain` يُبقي الصورة كاملةً ولا يقطع
  // رأساً، والفراغ حولها شفّافٌ لا أبيض.
  let out: Buffer;
  try {
    out = await sharp(input)
      .resize(SIDE, SIDE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      // جودةُ ٨٢ لا تُفرَّق بالعين على بطاقةٍ عرضُها ٧٢ بكسلاً،
      // و`alphaQuality: 100` يُبقي حافّةَ القصّ نظيفةً بلا هالةٍ رمادية
      .webp({ quality: 82, alphaQuality: 100, effort: 5 })
      .toBuffer();
  } catch {
    return { ok: false, reason: "تعذّر تحويل الصورة" };
  }

  // وبعد الفكّ: أفيها شيءٌ يُرى؟ صورةٌ شفّافةٌ بالكامل أو بيضاء بالكامل
  // تمرّ كل الفحوص السابقة ولا تُعرَض شيئاً.
  const stats = await sharp(out).stats();
  const alpha = stats.channels[3];
  const visible = alpha ? alpha.mean / 255 : 1;
  if (visible < 0.01) {
    return { ok: false, reason: "الصورة شفّافة بالكامل — لا شيء فيها يُعرَض" };
  }

  return {
    ok: true,
    dataUrl: `data:image/webp;base64,${out.toString("base64")}`,
    bytes: out.length,
  };
}

/** يحفظ الصورة لصاحبها — صورةٌ واحدة، تُستبدَل ولا تُجمَع. */
export async function saveAvatar(
  subject: AvatarSubject,
  input: Buffer
): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  const normalized = await normalizeAvatar(input);
  if (!normalized.ok) return normalized;

  // الختمُ يُكتَب مع البيانات في نفس التحديث لا في تحديثٍ ثانٍ: لو
  // انفصلا لأمكن أن تُكتَب صورةٌ بختمٍ قديم، فيَعرض المتصفّحُ السابقةَ
  // سنةً كاملة — المخزَن `immutable`، فلا شيءَ يُصحّح الختمَ بعدها.
  const stamped = { avatarData: normalized.dataUrl, avatarVersion: new Date() };

  if (subject.kind === "member") {
    const exists = await prisma.member.findUnique({ where: { id: subject.id }, select: { id: true } });
    if (!exists) return { ok: false, reason: "السجل غير موجود" };
    await prisma.member.update({ where: { id: subject.id }, data: stamped });
  } else {
    const exists = await prisma.user.findUnique({ where: { id: subject.id }, select: { id: true } });
    if (!exists) return { ok: false, reason: "الحساب غير موجود" };
    await prisma.user.update({ where: { id: subject.id }, data: stamped });
  }

  return { ok: true, bytes: normalized.bytes };
}

/** يحذف الصورة — فيعود العنصر الافتراضي */
export async function clearAvatar(subject: AvatarSubject): Promise<void> {
  if (subject.kind === "member") {
    await prisma.member.update({
      where: { id: subject.id },
      data: { avatarData: null, avatarVersion: null },
    });
  } else {
    await prisma.user.update({
      where: { id: subject.id },
      data: { avatarData: null, avatarVersion: null },
    });
  }
}
