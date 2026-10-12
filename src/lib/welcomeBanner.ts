import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import sharp from "sharp";
import { BRAND, themeFromColor } from "@/lib/brand";

/** اللوحة المتحرّكة الترحيبية — مُخصَّصة فعلاً لا موصوفةً في المواصفة.
 *
 *  اللوحة الأصلية (١٢٠٠×٤٠٠، ٤٦ إطاراً) وصلت بخانات مكتوبة فيها:
 *  «[ اسم العضو ]» و«[ الدور ]» واسم قسمٍ بعينه. وهي نصٌّ محروق في
 *  الإطارات، فلا يتبدّل من داخل الملف — وهذا ما قالته المواصفة صريحاً:
 *  لا تتظاهر بأن الملف الأصلي يتغيّر داخلياً.
 *
 *  فالحلّ: تُمحى الخانات الثلاث من الإطارات مرّةً واحدة (خارج التنفيذ،
 *  فصارت `public/brand/banner/<لون>.gif` بأربع نسخٍ بألوان الأقسام)،
 *  ثم يُركَّب نصُّ العضو الحقيقي على **كل إطار** عند الطلب فيُخرَج GIF
 *  متحرّكٌ يحمل اسمه ومسمّاه وقسمه.
 *
 *  **ولماذا صورةٌ واحدة لا نصٌّ حيٌّ فوق صورة؟** لأن Gmail على الجوال
 *  يعكس ألوان CSS في الوضع الداكن ولا يعكس الصور. فنصٌّ حيٌّ بجانب صورةٍ
 *  على الخلفية نفسها ينقلب وحده: يظهر مستطيلٌ بلون ولون. أما اللوحة
 *  كصورةٍ واحدة فتبقى كما هي في الوضعين.
 *
 *  **ومقاسات النصّ ليست تقديراً:** قيست من الملف الأصلي بإسقاط الحبر
 *  على الصفوف والأعمدة — سطر الاسم y=١٨٠..٢٢٣ محاذىً لليمين عند
 *  x=١١٣٣، وسطر الدور y=٢٣٢..٢٤٨، وسطر القسم y=١٨١..٢٢٣ محاذىً لليسار
 *  عند x=٦٥. فيقع النصّ الجديد في موضع القديم بالضبط.
 */

export const BANNER_W = 1200;
export const BANNER_H = 400;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** لوحةٌ واحدة رمادية، وألوانها تُحسَب من لون القسم نفسه.
 *
 *  كانت أربع نسخٍ مخزونة بألوان الأقسام الأربعة. وهذا يعني أن قسماً
 *  خامساً بلونٍ جديد لا يجد لوحته — وهو ما نهت عنه المواصفة صريحاً:
 *  لا تفترض أن كل قسمٍ يستعمل أحد الألوان الأربعة.
 *
 *  فصار الأصل واحداً: `base.gif` رماديٌّ خلفيتُه أسود تماماً وحبرُه
 *  أبيض. ولأن كل بكسلٍ فيه بين الاثنين، يُحوَّل بخَطٍّ بسيط لكل قناة:
 *
 *      الناتج = الخلفية + الرمادي × (الحبر − الخلفية)
 *
 *  أي `linear(a, b)` في sharp حيث `a = (ink − bg)/255` و`b = bg`. فأيُّ
 *  لونٍ يُعطى للقسم تُبنى لوحته منه، وحواشي الحروف المُنعَّمة تتدرّج
 *  بين اللونين الصحيحين بلا أطرافٍ من اللون القديم.
 *
 *  ولون الحبر لا يُختار ذوقاً: `themeFromColor` يحسمه بالتباين — فالبيج
 *  يُكتب عليه بالداكن وغيره بالفاتح، ولا قائمة استثناءاتٍ تُنسى. */
function bannerColors(colorHex: string | null | undefined): { bg: string; ink: string } {
  const bg = colorHex?.trim() || BRAND.temptress;
  const theme = themeFromColor(bg);
  // على الفاتح يُكتب بحبر الهوية الداكن، وعلى الداكن بالبيج
  const ink = theme.text === BRAND.ink ? BRAND.temptress : BRAND.beige;
  return { bg, ink };
}

/** مواضع الأسطر الثلاثة، مقيسةً من اللوحة الأصلية بالبكسل */
const SLOT = {
  /** الاسم: محاذىً لليمين عند الحدّ الأيمن للكتلة */
  name: { right: 1133, baseline: 215, size: 40, maxWidth: 268, weight: 700 },
  /** المسمّى الوظيفي: تحت الاسم، بالحجم الصغير */
  role: { right: 1133, baseline: 247, size: 19, maxWidth: 250, weight: 400 },
  /** القسم: محاذىً لليسار عند الحدّ الأيسر للكتلة */
  team: { left: 65, baseline: 215, size: 34, maxWidth: 245, weight: 700 },
} as const;

/** يُقصّ ما لا يتّسع بدل أن يفيض على الزخرفة.
 *
 *  اسمٌ من خمس كلمات يتجاوز الكتلة ويدخل في الرمز المتحرّك. والتصغير
 *  وحده يجعله غير مقروء، فيُصغَّر إلى حدٍّ ثم يُقصَّر. */
function fitSize(text: string, slot: { size: number; maxWidth: number }): number {
  // تقدير عرض الحرف العربي بخط Cairo ≈ 0.52 من حجم الخط
  const est = text.length * slot.size * 0.52;
  if (est <= slot.maxWidth) return slot.size;
  const scaled = Math.floor((slot.maxWidth / est) * slot.size);
  return Math.max(Math.floor(slot.size * 0.62), scaled);
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}

/** طبقة النصّ: SVG بحجم إطارٍ واحد، شفافةٌ إلا من الأسطر الثلاثة */
function textLayerSvg(opts: {
  fullName: string;
  role: string | null;
  team: string | null;
  ink: string;
}): string {
  const nameSize = fitSize(opts.fullName, SLOT.name);
  const roleSize = opts.role ? fitSize(opts.role, SLOT.role) : SLOT.role.size;
  const teamSize = opts.team ? fitSize(opts.team, SLOT.team) : SLOT.team.size;
  const font = "Cairo, 'Noto Sans Arabic', 'DejaVu Sans', sans-serif";

  // محاذاة RTL: `text-anchor="start"` يضع بداية النصّ (وهي يمينه) عند x
  const lines: string[] = [
    `<text x="${SLOT.name.right}" y="${SLOT.name.baseline}" font-family="${font}" font-size="${nameSize}" font-weight="700" fill="${opts.ink}" direction="rtl" text-anchor="start" xml:space="preserve">${escapeXml(opts.fullName)}</text>`,
  ];
  if (opts.role) {
    lines.push(
      `<text x="${SLOT.role.right}" y="${SLOT.role.baseline}" font-family="${font}" font-size="${roleSize}" font-weight="400" fill="${opts.ink}" fill-opacity="0.82" direction="rtl" text-anchor="start" xml:space="preserve">${escapeXml(opts.role)}</text>`
    );
  }
  if (opts.team) {
    // القسم محاذىً لليسار: مع RTL تكون النهاية عند الحدّ الأيسر
    lines.push(
      `<text x="${SLOT.team.left}" y="${SLOT.team.baseline}" font-family="${font}" font-size="${teamSize}" font-weight="700" fill="${opts.ink}" direction="rtl" text-anchor="end" xml:space="preserve">${escapeXml(opts.team)}</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_W}" height="${BANNER_H}">${lines.join("")}</svg>`;
}

const BASE_GIF = join(process.cwd(), "public", "brand", "banner", "base.gif");

/** يُهيّئ fontconfig ليجد خطّ الهوية.
 *
 *  librsvg يرسم نصّ SVG عبر pango/fontconfig، وهما يبحثان عن الخطوط في
 *  نظام التشغيل لا في المشروع. وبيئة التنفيذ في السحابة لا خطّ عربي
 *  فيها بالضرورة — فيُكتب ملفّ إعدادٍ يُشير إلى `assets/fonts` ويُصدَّر
 *  `FONTCONFIG_FILE`. وبلا هذا يرسم الاسم مربّعاتٍ فارغة. */
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = join(process.cwd(), "assets", "fonts");
  if (!existsSync(dir)) {
    fontsReady = true;
    return;
  }
  const cacheDir = join(tmpdir(), "fontconfig-tlaqi");
  try {
    mkdirSync(cacheDir, { recursive: true });
    const conf = join(cacheDir, "fonts.conf");
    writeFileSync(
      conf,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>` +
        `<dir>${dir}</dir><dir>/usr/share/fonts</dir><cachedir>${cacheDir}</cachedir>` +
        `</fontconfig>`
    );
    process.env.FONTCONFIG_FILE = conf;
    process.env.FONTCONFIG_PATH = cacheDir;
  } catch {
    // تعذّرت الكتابة: يبقى بحث الخطوط على إعداد النظام
  }
  fontsReady = true;
}

export type BannerData = {
  fullName: string;
  role: string | null;
  team: string | null;
  colorHex: string | null;
};

/** يبني اللوحة المتحرّكة لهذا العضو.
 *
 *  sharp يقرأ الـGIF المتحرّك شريطاً رأسياً من ٤٦ إطاراً، فتُركَّب طبقة
 *  النصّ على كل إطار بإزاحةٍ قدرها `فهرس الإطار × ٤٠٠`. فالنصّ ثابت
 *  والزخرفة تتحرّك تحته — كما في التصميم الأصلي. */
export async function renderWelcomeBanner(data: BannerData): Promise<Buffer> {
  ensureFonts();

  const { bg, ink } = bannerColors(data.colorHex);
  const [br, bgC, bb] = hexToRgb(bg);
  const [ir, ig, ib] = hexToRgb(ink);

  const master = readFileSync(BASE_GIF);
  const meta = await sharp(master, { animated: true }).metadata();
  const frames = meta.pages ?? 1;

  const layerPng = await sharp(
    Buffer.from(textLayerSvg({ fullName: data.fullName, role: data.role, team: data.team, ink }))
  )
    .png()
    .toBuffer();

  // **حارسٌ ضدّ عطبٍ لا يظهر إلا في الإنتاج.** librsvg يرسم نصّ SVG عبر
  // pango/fontconfig. فإن لم تجد بيئةُ التنفيذ خطّاً عربياً — أو لم
  // يُبنَ libvips بدعم النصّ أصلاً — خرجت الطبقة فارغةً تماماً، ووصلت
  // اللوحة بلا اسم: صورةٌ تبدو سليمة وقد فقدت كلّ ما يجعلها مُخصَّصة.
  // فتُقاس الطبقة: إن لم يكن فيها حبرٌ يُذكَر فذاك عطبُ خطوط لا اسمٌ
  // فارغ، ويُرفع ليُقرأ في السجل بدل أن يمرّ صامتاً.
  const layerStats = await sharp(layerPng).stats();
  const alphaMean = layerStats.channels[3]?.mean ?? 0;
  if (alphaMean < 0.05) {
    throw new Error(
      "طبقة نصّ اللوحة خرجت فارغة — الأرجح أن بيئة التنفيذ لا تجد خطّاً عربياً (fontconfig/pango)"
    );
  }

  const composite = Array.from({ length: frames }, (_, i) => ({
    input: layerPng,
    top: i * BANNER_H,
    left: 0,
  }));

  // **مرحلتان لا واحدة.** sharp لا ينفّذ العمليات بترتيب استدعائها: فهو
  // يرتّبها في مراحل، و`linear` (تحويل لوني) يُطبَّق **بعد** التركيب لا
  // قبله. فلمّا كانا في أنبوبٍ واحد، كان نصُّ العضو يُركَّب على الأصل
  // الرمادي ثم يُحوَّل معه — فحبرُه الداكن يُرسَم إلى لون الخلفية ويختفي
  // تقريباً. قُيس ذلك: أغمق بكسل في الاسم كان (200,221,192) على خلفية
  // (238,246,223)، بينما الرمز يصل (52,29,43) كما يجب.
  //
  // فصار التلوين أولاً إلى مخزنٍ مستقل، ثم التركيب على الناتج الملوّن.
  const tinted = await sharp(master, { animated: true })
    // الرمادي يصير لون القسم: أسود ← الخلفية، أبيض ← الحبر
    .linear([(ir - br) / 255, (ig - bgC) / 255, (ib - bb) / 255], [br, bgC, bb])
    .gif({ loop: 0 })
    .toBuffer();

  return sharp(tinted, { animated: true })
    .composite(composite)
    .gif({ loop: 0 })
    .toBuffer();
}

/** بديلٌ ساكن حين يتعذّر التوليد.
 *
 *  لا تبقى الرسالة بلا لوحة: تُرجَع نسخة القسم كما هي (بلا اسم) بدل
 *  صورةٍ مكسورة. والاسم والمسمّى والقسم مكتوبون في متن الرسالة نصّاً
 *  حيّاً أصلاً، فلا تُفقَد المعلومة. */
export const STATIC_BANNER_PATH = "/brand/banner/base.gif";
