import { readFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { BRAND, themeFromColor } from "@/lib/brand";
import { ensureFonts } from "@/lib/welcomeBanner";
import { firstName } from "@/lib/personName";

/** صورتا المشاركة: ملصقُ الدعوة، وبطاقةُ العضوية.
 *
 *  **لماذا صورةٌ لا HTML؟** المطلوب أن يُصوِّر صاحبُها الشاشة فينشرها
 *  كما هي. والبريد لا يحمل خطَّ الهوية (Gmail يُسقط `@font-face`)،
 *  ويقلب الألوان في الوضع الداكن، ويرسم كلُّ عميلٍ الجداول بطريقته — فلا
 *  يصل التصميم مرّتين بالشكل نفسه. أما الصورة فتُرسَم هنا مرّةً بخطّ
 *  الهوية نفسه (The Year of The Camel)، فتصل في كلّ صندوقٍ كما صُمِّمت، ولا ينقلبها الوضع الداكن.
 *
 *  **والمقاس ١٠٨٠×١٣٥٠ (٤:٥)** — مقاسُ منشور إنستغرام العمودي، فتُنشر بلا
 *  قصّ. والرسمُ بالأدوات نفسها التي ترسم اللوحة الترحيبية (sharp +
 *  librsvg + خطّ `assets/fonts`) ويحرسها فحصُ البناء نفسه.
 *
 *  ولا يُكتب في الصورتين إلا ما في السجلّ: الاسم والقسم والمسمّى
 *  والتاريخ والداعي. لا إنجازٌ مُخترَع ولا رقمٌ مُقدَّر. */

export const CARD_W = 1080;
export const CARD_H = 1350;

/** خطُّ الهوية الرسمي (قرار المؤسس، نوفمبر 2026) من `assets/fonts` — وCairo احتياطٌ إن غاب */
const FONT = "'The Year of The Camel', Cairo, 'Noto Sans Arabic', 'DejaVu Sans', sans-serif";
const BRAND_DIR = join(process.cwd(), "public", "brand");

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}

/** التاريخ بالأرقام العربية والشهر باسمه: «٢٠ أكتوبر ٢٠٢٦» */
export function cardDate(d: Date): string {
  return new Intl.DateTimeFormat("ar-u-ca-gregory-nu-arab", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

const logoCache = new Map<string, string>();
/** ملفُّ الشعار الرسمي كما في حزمة الهوية — لا يُلوَّن ولا يُعدَّل */
function logoUri(file: string): string {
  const hit = logoCache.get(file);
  if (hit) return hit;
  const uri = `data:image/png;base64,${readFileSync(join(BRAND_DIR, "2026", "logos", `TLAQI-logo-full_${file}.png`)).toString("base64")}`;
  logoCache.set(file, uri);
  return uri;
}

/** عرضُ النصّ كما يرسمه pango فعلاً — لا تقديراً بعدد الحروف.
 *
 *  الاسم أكبرُ ما في البطاقة، والتقديرُ يُخطئ في العربية (الحروف
 *  المتّصلة أعرض من المنفصلة بكثير). فيُرسم مرّةً وحده ويُقاس. */
async function textWidth(text: string, size: number, weight = 700): Promise<number> {
  const w = Math.ceil(text.length * size * 0.9) + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.ceil(size * 2)}"><text x="${w - 10}" y="${Math.ceil(size * 1.4)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="#000" direction="rtl" text-anchor="start">${escapeXml(text)}</text></svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    return text.length * size * 0.55;
  }
}

/** أكبرُ حجمٍ يتّسع به النصّ — ثم لا يصغُر دون حدٍّ يُقرأ */
async function fit(text: string, size: number, maxWidth: number, min: number, weight = 700): Promise<number> {
  const w = await textWidth(text, size, weight);
  if (w <= maxWidth) return size;
  return Math.max(min, Math.floor((size * maxWidth) / w));
}

/** نصٌّ عربيٌّ يبدأ من اليمين عند `x` (أو ينتهي يساراً عنده) */
function t(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opts: { weight?: number; opacity?: number; anchor?: "right" | "left" | "middle"; ltr?: boolean } = {}
): string {
  const dir = opts.ltr ? "ltr" : "rtl";
  // في RTL: «start» هو اليمين. وفي LTR: «start» هو اليسار.
  const anchor =
    opts.anchor === "middle"
      ? "middle"
      : opts.ltr
        ? opts.anchor === "right" ? "end" : "start"
        : opts.anchor === "left" ? "end" : "start";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${fill}"${opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : ""} direction="${dir}" text-anchor="${anchor}" xml:space="preserve">${escapeXml(text)}</text>`;
}

/** ألوانُ البطاقة ونسخةُ الشعار ولونُ النمط — من دليل الهوية (`docs/brand/KIT-README.md`)، لا اجتهاداً.
 *
 *  **قرار المؤسس:** كل بطاقةٍ بلون قسمها كاملاً (واللجنةُ بلون قسمها)، والشعارُ **بنسخته الرسمية لذلك اللون** —
 *  مفرَّغاً بلونٍ واحد على Mahogany (Beige) وGreen Sheen (Temptress)، وبنسختيه المعتمدتين على Beige وTemptress — لا
 *  لوحةَ خلفه ولا تلوينَ له. ولونٍ غيرِ الأربعة: النسخةُ المفرَّغة التي تقرأ عليه (Beige على الداكن، Temptress على
 *  الفاتح). والنمطُ بلون الدليل: Mahogany على Beige، وBeige على Temptress والداكن، وTemptress على Green Sheen والفاتح. */
type LogoFile = "on-beige" | "on-temptress" | "on-mahogany" | "on-green-sheen";
type PatternColor = "beige" | "temptress" | "mahogany" | "green-sheen";
function palette(colorHex: string | null | undefined) {
  // لونٌ سداسيٌّ صريحٌ وحده يدخل الـSVG؛ وما سواه (قيمةٌ معطوبة) يُرسم بلون الهوية الافتراضي
  const raw = colorHex?.trim() ?? "";
  const bg = (/^#[0-9A-Fa-f]{6}$/.test(raw) ? raw : BRAND.temptress).toUpperCase();
  const onLight = themeFromColor(bg).text === BRAND.ink;
  const ink = onLight ? BRAND.temptress : BRAND.beige;
  const official: Record<string, [LogoFile, PatternColor]> = {
    [BRAND.beige.toUpperCase()]: ["on-beige", "mahogany"],
    [BRAND.temptress.toUpperCase()]: ["on-temptress", "beige"],
    [BRAND.mahogany.toUpperCase()]: ["on-mahogany", "beige"],
    [BRAND.greenSheen.toUpperCase()]: ["on-green-sheen", "temptress"],
  };
  const [logo, pattern] = official[bg] ?? (onLight ? ["on-green-sheen", "temptress"] : ["on-mahogany", "beige"]);
  return { bg, onLight, ink, logo: logo as LogoFile, pattern: pattern as PatternColor };
}

/** وزنُ الاسم البطل: ملفُّ ExtraBold من خطّ الهوية (Bold فيه خفيفٌ بطبعه) */
const HERO = 900;

/** شبكةُ البطاقتين (قرار المؤسس): **عمودُ الأنماط طوليٌّ على الجانب** — عمودُ «موهبة» ثم عمودُ «ابتكار»، كلٌّ بعرض
 *  بلاطةٍ واحدة وبطول البطاقة — والمحتوى إلى يمينه على لونٍ صلب (لا نمطَ خلف نص). ولا يُستعمل نمطُ «ربط». */
// بلاطاتٌ كاملة فقط: ١٨ صفاً (١٢٩٦) في وسط ارتفاع البطاقة (١٣٥٠) — لا شكلَ مقطوعاً عند الحافتين
const COLUMN = { x: 0, w: 2 * 72, rows: 18, y: (1350 - 18 * 72) / 2 };
const L = COLUMN.w + 66;
const R = 1080 - 90;
const ROW = { rule: 1100, label: 1152, value: 1202, extra: 1266 };

/** الشعارُ الرسمي بنسخة اللون — موضعٌ واحدٌ وحجمٌ واحد في البطاقتين (٢٤٠٠×٧٠٦ في الأصل) */
const LOGO = { w: 340, h: 100, top: 72 };
function lockupSvg(p: ReturnType<typeof palette>, right: number): string {
  return `<image href="${logoUri(p.logo)}" x="${right - LOGO.w}" y="${LOGO.top}" width="${LOGO.w}" height="${LOGO.h}"/>`;
}

/** شارةُ القسم أعلى اليسار — مشتركةٌ بين البطاقتين، بحبرٍ صريح بلا شفافية */
async function deptChip(p: ReturnType<typeof palette>, dept: string, left: number): Promise<string> {
  const w = Math.min(420, (await textWidth(dept, 26)) + 56);
  return `<rect x="${left}" y="93" width="${w}" height="58" rx="29" fill="none" stroke="${p.ink}" stroke-width="2"/>${t(dept, left + w / 2, 131, 26, p.ink, { weight: 700, anchor: "middle" })}`;
}

/** **النمطُ في عمودٍ منفصل لا خلف النص** (قاعدة الدليل)، بمقاس M للبطاقات وبلاطاتٍ كاملة على شبكةٍ واحدة:
 *  «موهبة» — النمطُ الأساسي — و«ابتكار» متجاوران. */
const TILE = 72;
const patternCache = new Map<string, string>();
function patternTile(kind: "talent" | "innovation" | "link", color: PatternColor): string {
  const key = `${kind}_${color}`;
  const hit = patternCache.get(key);
  if (hit) return hit;
  const raw = readFileSync(join(BRAND_DIR, "2026", "patterns", `pattern-${kind}_M_${color}.svg`), "utf8");
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  patternCache.set(key, inner);
  return inner;
}
function patternColumns(p: ReturnType<typeof palette>): string {
  return (["talent", "innovation"] as const)
    .map((kind, i) => {
      const x = COLUMN.x + i * TILE;
      const id = `pat-${kind}-${p.pattern}`;
      return `<defs><pattern id="${id}" x="${x}" y="${COLUMN.y}" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse">${patternTile(kind, p.pattern)}</pattern></defs><rect x="${x}" y="${COLUMN.y}" width="${TILE}" height="${COLUMN.rows * TILE}" fill="url(#${id})"/>`;
    })
    .join("");
}

async function toPng(svg: string): Promise<Buffer> {
  ensureFonts();
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export type InviteCardData = {
  fullName: string;
  /** الموقع الذي دُعي إليه بصيغةٍ لا تحتاج جنساً: «قيادة قسم التقنية» */
  position: string;
  /** المسمّى الذي حدّدته الإدارة الداعية — إن وُجد */
  jobTitle: string | null;
  departmentName: string | null;
  colorHex: string | null;
  invitedByName: string | null;
  issuedAt: Date;
};

/** ملصقُ الدعوة — المفهوم «ب»: لونُ القسم يملأ الإطار، والاسمُ بطلُه.
 *
 *  وليس ترحيباً: من وصله لم يُعتمد بعد. فيقول «دعوة خاصّة» ومَن دعاه،
 *  والترحيبُ يأتي ببطاقة العضوية عند الاعتماد. */
export async function renderInviteCard(d: InviteCardData): Promise<Buffer> {
  // الخطوط قبل أوّل رسم — والقياسُ رسمٌ أيضاً: لو سبقها لقرأ fontconfig
  // إعداد النظام مرّةً وثبّته، فيُرسم كلُّ ما بعده بخطٍّ غير خطّ الهوية
  ensureFonts();
  const p = palette(d.colorHex);
  const first = firstName(d.fullName);
  const firstSize = await fit(first, 200, R - L, 110, HERO);
  const fullSize = await fit(d.fullName, 34, 380, 22);
  const byName = d.invitedByName?.trim() || "إدارة تلاق";
  const bySize = await fit(byName, 34, 360, 22);
  const chip = await deptChip(p, d.departmentName?.trim() || "تلاق", L);
  const role = d.jobTitle?.trim() ? `${d.position} · ${d.jobTitle.trim()}` : d.position;
  const roleSize = await fit(role, 36, R - L, 24);
  const nameY = 460 + firstSize;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  ${lockupSvg(p, R)}
  ${chip}
  ${patternColumns(p)}
  ${t("دعوة خاصّة", R, 440, 40, p.ink, { weight: 700 })}
  ${t(first, R, nameY, firstSize, p.ink, { weight: HERO })}
  ${t("للانضمام إلى فريق تلاق", R, nameY + 84, 44, p.ink)}
  ${t(role, R, nameY + 146, roleSize, p.ink, { weight: 700 })}
  <line x1="${L}" y1="${ROW.rule}" x2="${R}" y2="${ROW.rule}" stroke="${p.ink}" stroke-width="2"/>
  ${t("الاسم", R, ROW.label, 24, p.ink)}
  ${t(d.fullName, R, ROW.value, fullSize, p.ink, { weight: 700 })}
  ${t("بدعوةٍ من", L, ROW.label, 24, p.ink, { anchor: "left" })}
  ${t(byName, L, ROW.value, bySize, p.ink, { weight: 700, anchor: "left" })}
  ${t(cardDate(d.issuedAt), L, ROW.extra, 24, p.ink, { anchor: "left" })}
</svg>`;
  return toPng(svg);
}

export type WelcomeCardData = {
  fullName: string;
  /** «أهلاً بك» أو «أهلاً بكِ» — بجنس صاحبها */
  greeting: string;
  /** المسمّى تحت الاسم: المسمّى الوظيفي، أو الصفة إن لم يكن له مسمّى */
  title: string;
  /** الصفة بجنسها: «قائدة قسم التسويق»، «عضوة» */
  roleTitle: string;
  /** «انضمّ في» أو «انضمّت في» */
  joinedLabel: string;
  joinedAt: Date;
  departmentName: string | null;
  colorHex: string | null;
};

/** **علامةُ الشعار الرسمية** بنسختها لذلك اللون — الملفُّ نفسُه من حزمة الهوية، مصغَّراً لا ملوَّناً */
const MARK_FOR: Record<LogoFile, string> = {
  "on-temptress": "TLAQI-mark_mahogany.png",
  "on-beige": "TLAQI-mark_mahogany.png",
  "on-mahogany": "TLAQI-mark_beige.png",
  "on-green-sheen": "TLAQI-mark_temptress.png",
};
/** للفحص الآلي: نسخةُ الشعار وعلامتُه لكل لون كما اعتمدها المؤسس (نوفمبر 2026) — `scripts/check-brand-identity.ts` */
export function approvedLogoFor(colorHex: string): { logo: LogoFile; mark: string } {
  const logo = palette(colorHex).logo;
  return { logo, mark: MARK_FOR[logo] };
}


/** **بطاقةُ الاعتماد (العضوية)** — التصميمُ الذي اعتمده المؤسس (نوفمبر 2026):
 *  - **أعلى الصفحة:** «بطاقة انضمام» ثم ترحيبٌ مكبَّرٌ بالاسم الأول وحده: «سارة، أهلاً بكِ في العائلة».
 *  - **البطاقة:** الشعارُ الرسميُّ يساراً واسمُ القسم أو اللجنة يميناً فوق الاسم، ثم الاسمُ بالخطّ العريض والمسمّى، ثم تاريخُ
 *    الانضمام والصفة. الخلفيةُ والبطاقةُ بلون القسم الصافي (واللجنةُ بلون قسمها)، والبطاقةُ تُفرَد بإطارٍ وظلّ.
 *  - **الشعارُ بنسخته الرسمية لذلك اللون** (لا تلوين): البنفسجي علامةٌ برتقالية وكلمةٌ Beige؛ الـBeige علامةٌ برتقالية؛
 *    البرتقالي أبيضُ (Beige) كاملاً؛ الأخضر بنفسجيٌّ كاملاً — والنصُّ بحبر تلك النسخة.
 *  - **الأنماطُ الثلاثة خافتةً في الخلفية**، ولا نمطَ خلف نص.
 *
 *  تصل مع رسالة الاعتماد وحدها: هي الإعلان أنّ صاحبها صار منّا. */
export async function renderWelcomeCard(d: WelcomeCardData): Promise<Buffer> {
  ensureFonts();
  const card = palette(d.colorHex);
  const page = card.bg;
  const pageInk = card.ink;
  const pageLogo: LogoFile = card.logo;
  const cardInk = card.ink;
  const cardStroke = ` stroke="${card.ink}" stroke-width="2.5"`;
  const C = CARD_W / 2;
  const X = 180;
  const W = CARD_W - 2 * X;
  const R = X + W - 56;
  const IL = X + 56;
  // الترحيبُ مكبَّرٌ بالاسم الأول وحده (قرار المؤسس)، وعرضُه محدودٌ (٦٤٠) فلا يبلغ شكلَ «موهبة» في الزاوية العليا
  const welcome = `${firstName(d.fullName)}، ${d.greeting} في العائلة`;
  const welcomeSize = await fit(welcome, 66, 640, 40);
  const nameSize = await fit(d.fullName, 92, W - 112, 34, HERO); // الحدُّ الأدنى يسع اسماً رباعياً طويلاً داخل البطاقة
  const titleSize = await fit(d.title, 40, W - 112, 26);
  const roleSize = await fit(d.roleTitle, 32, 300, 22);
  const dept = d.departmentName?.trim() || "تلاق";
  // القسمُ يميناً والشعارُ يساراً (قرار المؤسس): لا يتجاوز ما بينهما (اسمُ لجنةٍ طويل يصغُر ولا يبلغ الشعار)
  const deptSize = await fit(dept, 28, W - 112 - 280 - 40, 18);
  const nameY = 600 + nameSize;
  // **نمطان كبيران خافتان في الخلفية (قرار المؤسس):** شكلُ «موهبة» في الزاوية العليا وشكلُ «ابتكار» في الزاوية السفلى
  // المقابلة، كلٌّ منهما شكلٌ واحدٌ مكبَّرٌ بنسبته (لا تمديد ولا تدوير) يخرج عن الحافة، بحبر الخلفية وبشفافيةٍ خفيفة —
  // فيُرى أثراً هادئاً لا زحمة. ويقعان خلف البطاقة والهوامش وحدها، فلا نمطَ خلف نص.
  const inkName: PatternColor = card.ink === BRAND.temptress ? "temptress" : "beige";
  const faint = card.onLight ? 0.07 : 0.1;
  const motif = (kind: "talent" | "innovation", cx: number, cy: number, scale: number) =>
    `<g opacity="${faint}" transform="translate(${cx} ${cy}) scale(${scale}) translate(-36 -36)">${patternTile(kind, inkName)}</g>`;
  // مقاسٌ يُقرأ به الشكلُ كاملاً (نحو ٣٦٠ بكسلاً)، وتقطعه الحافةُ قليلاً فيبدو ممتدّاً خارج البطاقة لا ملصقاً عليها
  // والثالثُ «ربط» — قوسٌ يصل نقطتين (معناه في الدليل: الصلةُ بين الموهبة والجهة): قوسٌ واحدٌ كبيرٌ كالجسر، طرفاه على الحافة
  // السفلى في الزاوية الحرّة — فتتوزّع الثلاثةُ على البطاقة بلا تكرار: «موهبة» أعلى، و«ابتكار» و«ربط» أسفلُ على الجانبين
  const arc = (patternTile("link", inkName).match(/<path[^>]*transform="translate\(18 18\)"[^>]*\/>/) ?? [""])[0];
  const link = arc ? `<g opacity="${faint}" transform="translate(${CARD_W - 185} ${CARD_H - 150}) scale(15) translate(-18 -18)">${arc}</g>` : "";
  // «موهبة» مدفوعٌ إلى الزاوية العليا (يخرج نصفُه عن الحافة) فيبقى عن يمين الترحيب وفوقه، لا خلفه
  const motifs = motif("talent", CARD_W - 80, 110, 9) + motif("innovation", 150, CARD_H - 170, 9) + link;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="26"/><feOffset dy="30"/><feComponentTransfer><feFuncA type="linear" slope="0.38"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" fill="${page}"/>
  ${motifs}
  ${t("بطاقة انضمام", C, 180, 26, pageInk, { anchor: "middle" })}
  ${t(welcome, C, 272, welcomeSize, pageInk, { weight: 700, anchor: "middle" })}
  <g filter="url(#shadow)"><rect x="${X}" y="360" width="${W}" height="680" rx="48" fill="${card.bg}"${cardStroke}/></g>
  <image href="${logoUri(pageLogo)}" x="${IL}" y="410" width="280" height="${Math.round((280 * 706) / 2400)}"/>
  ${t(dept, R, 462, deptSize, cardInk, { weight: 700 })}
  ${t(d.fullName, R, nameY, nameSize, cardInk, { weight: HERO })}
  ${t(d.title, R, nameY + 70, titleSize, cardInk)}
  <line x1="${IL}" y1="850" x2="${R}" y2="850" stroke="${cardInk}" stroke-width="2"/>
  ${t(d.joinedLabel, R, 912, 24, cardInk)}
  ${t(cardDate(d.joinedAt), R, 964, 34, cardInk, { weight: 700 })}
  ${t("الصفة", IL, 912, 24, cardInk, { anchor: "left" })}
  ${t(d.roleTitle, IL, 964, roleSize, cardInk, { weight: 700, anchor: "left" })}
  ${t("تحوّل رقمي، برؤية طموحة.", C, 1166, 30, pageInk, { anchor: "middle" })}
  ${t("@tlaqisa", C, 1216, 26, pageInk, { anchor: "middle", ltr: true })}
</svg>`;
  return toPng(svg);
}
