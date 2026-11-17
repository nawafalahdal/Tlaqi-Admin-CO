import type { EmailContent, EmailTheme } from "@/lib/emailBrand";
import { HEX, EMAIL_FONT_STACK } from "./tokens";
import { EMAIL_BRAND_ASSETS, type EmailBrandAssetKey } from "./emailAssets.generated";

/** **قالبُ البريد — بلا إطارٍ أبيض، في الوضعين الفاتح والداكن** (طلب المؤسس، 17 نوفمبر 2026: «لا أبغى الإطار الأبيض أبداً.
 *  خلّه على خلفية الإيميل، وحطّ الإطارات تبعنا كصور: صورةٌ في البداية للهيدر وصورةٌ في النهاية، وبينهم الكلام مرتّباً»).
 *
 *  **السببُ الجذري للإطار الأبيض الذي بقي:** كانت الهويةُ أشرطةً بخلفياتٍ ملوّنة بعرض الشاشة (ترويسةٌ داكنة، متنٌ Beige، تذييلٌ
 *  داكن، وخلفيةُ جسمٍ Mahogany). وتطبيقُ Gmail **يحذف لونَ صفحة الرسالة** ويضعها داخل هامشٍ من خلفيته هو (16 نقطة في iPhone،
 *  وفراغٌ تحتها حين تقصر) — فكلُّ شريطٍ ملوّن يُبرز حولَه إطاراً أبيضَ لا يصل إليه HTMLُ الرسالة. ولا علاجَ لذلك من داخل الرسالة
 *  ما دام فيها خلفيةٌ ملوّنة. **فلا خلفيةَ في الرسالة أصلاً:**
 *
 *  1. **الترويسةُ صورة** (`emailFrames`): لوحٌ Temptress بزوايا مستديرة — الشعارُ وجهةُ الرسالة بخطّ الهوية ونمطُ «موهبة».
 *  2. **المتنُ نصٌّ على خلفية تطبيق البريد نفسها** — بيضاءَ في الفاتح وداكنةً في الداكن — فلا حدَّ بينه وبين ما حوله.
 *  3. الروابطُ (X وLinkedIn) وسطرُ «مُرسَلة من» نصّاً قابلاً للنقر.
 *  4. **التذييلُ صورة**: العلامةُ و«نلتقي • نفكر • نصنع» و@tlaqisa على لوحٍ ينساب من Temptress إلى Mahogany.
 *
 *  **الوضعُ الداكن مدروسٌ لكل عميل:**
 *  - **الصورُ لا يقلبها أيُّ عميل** — فالترويسةُ والتذييلُ والبطاقةُ كما صُمّمت في الوضعين، وزواياها شفّافة.
 *  - **Apple Mail وiOS Mail وOutlook على Mac:** `color-scheme: light dark` يجعل الخلفيةَ داكنة، و`prefers-color-scheme` يقلب ألوانَ
 *    النص إلى Beige والعناوينَ إلى برتقاليٍّ فاتح (`DARK`).
 *  - **Outlook.com وتطبيقاته:** المحدِّدان `[data-ogsc]` و`[data-ogsb]` للألوان نفسها.
 *  - **Gmail:** لا يقرأ هذه القواعد؛ يقلب ألوانَ النص والحدود بنفسه — ولأنّ المتنَ بلا خلفيةٍ أصلاً فلا لونَ خلفيةٍ يُقلب فيظهر
 *    مربّعاً. والنصُّ داكنٌ على الفاتح، ويقلبه Gmail فاتحاً على الداكن.
 *  - **ولا صندوقَ ملوّنَ الخلفية في المتن:** الرمزُ والحقائقُ صناديقُ بحدودٍ لا بتعبئة؛ والزرُّ وحده ملوّن (Temptress، وفي الداكن
 *    حدٌّ Beige يفصله عن الخلفية).
 *
 *  والمحتوى في عمودٍ أقصاه 600px (وجدولٌ ثابتٌ لـOutlook على ويندوز)، والصورُ كلُّها مرنةٌ بسقف عرضها (لا تفرض على الهاتف عرضاً
 *  أوسعَ من شاشته). **والصور مضمّنةٌ بمعرّف `cid:`** — لا روابطَ خارجية. **والخط:** خطُّ النظام (Apple أولاً) ببدائل لكل جهاز،
 *  وجزءٌ خاصٌّ لـOutlook يفرض Tahoma؛ وخطُّ الهوية في الصورتين وحدهما. ولا شارةَ فوق العنوان (قرار المؤسس). */

const B = HEX;
const FONT = EMAIL_FONT_STACK;
/** ألوانُ المتن في الفاتح — نصٌّ داكنٌ على خلفية العميل */
const LIGHT = { title: B.mahogany, text: B.temptress, muted: "#6B5A66", link: B.mahogany, rule: "rgba(52,29,43,0.16)", frame: "rgba(52,29,43,0.28)" } as const;
/** وفي الداكن (Apple Mail وOutlook) — Beige الرسمي للنص، وبرتقاليٌّ أفتح للعناوين والروابط ليُقرأ على الداكن */
const DARK = { title: "#F08A52", text: B.beige, muted: "#C8BCC4", link: "#F4A274", rule: "rgba(238,246,223,0.22)", frame: "rgba(238,246,223,0.36)" } as const;

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** مصادرُ صور الهوية: `cid:` في البريد (الافتراضي)، وبياناتٌ مباشرة في ملفات المعاينة */
export type EmailImageSources = Record<EmailBrandAssetKey, string>;
export const CID_IMAGE_SOURCES = Object.fromEntries(
  (Object.keys(EMAIL_BRAND_ASSETS) as EmailBrandAssetKey[]).map((k) => [k, `cid:${EMAIL_BRAND_ASSETS[k].cid}`])
) as EmailImageSources;

/** **رسالةُ التعيين** (قائد اللجنة) بالبنية الموحَّدة نفسها، **ونصُّها مترابط** (طلب المؤسس، نوفمبر 2026): البيانُ فقرةٌ واحدة
 *  تسمّي صاحبَ التعيين ومُصدِرَه وموضعَه (`{name}` و`{issuer}` يُستبدلان بعد تهريب النص)، ثم الخطواتُ الأولى جملةً واحدة
 *  متصلة لا قائمةً مرقّمة، ثم الحقائقُ الأربع، ثم الزرّ. ولا شارةَ ولا سطرَ إنجليزيَّ فوق العنوان. */
function normalize(c: EmailContent): EmailContent {
  const a = c.appointment;
  if (!a) return c;
  const issuer = `<b>${esc(a.issuer.name)}</b>${a.issuer.title ? ` (${esc(a.issuer.title)})` : ""}`;
  const steps = a.steps.items.map((s) => esc(s.trim().replace(/[.،]+$/, ""))).join("، ثم ");
  return {
    ...c,
    title: c.title,
    lead: esc(a.statement).replace("{name}", `<b>${esc(a.name)}</b>`).replace("{issuer}", issuer),
    paragraphs: [`${esc(a.steps.title)}: ${steps}.`],
    // التاريخُ مرّةً واحدة: الحقائقُ تحمل «تاريخ التعيين» عادةً
    facts: a.facts.some(([k]) => k.includes("تاريخ")) ? a.facts : [...a.facts, ["التاريخ", a.date]],
    note: a.note ?? c.note,
  };
}

/** صفُّ محتوى بمسافته بعده — والصفُّ الأخير بلا مسافةٍ بعده: لا فراغَ متراكمٌ بين آخر سطرٍ والتذييل */
type Row = { html: string; top?: number; bottom: number };

const P = (size: number, extra = "") => `margin:0;font-family:${FONT};font-size:${size}px;line-height:1.85;color:${LIGHT.text};${extra}`;
/** فقرةٌ بلونها الذي يُقلب في الوضع الداكن (`t-text`) */
const para = (size: number, html: string, extra = "") => `<p class="t-text" style="${P(size, extra)}">${html}</p>`;

function body(raw: EmailContent): string {
  const c = normalize(raw);
  const r: Row[] = [];
  r.push({ html: `<h1 class="t-title" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.45;font-weight:800;color:${LIGHT.title}">${esc(c.title)}</h1>`, bottom: 10 });
  if (c.lead) r.push({ html: para(16, c.lead), bottom: 12 });

  const image = () => {
    if (!c.image) return;
    // **عرضٌ مرن بسقفٍ لا عرضٌ ثابت** (عطبٌ رآه المؤسس في Gmail على iPhone): الصورةُ بعرضٍ ثابت داخل خلية جدول تفرض في
    // WebKit عرضَ الجدول كلِّه (`max-width:100%` لا يصغّر الحدَّ الأدنى للخلية هناك) — فيتّسع البريد عن الشاشة، ويصغّره Gmail
    // ليتّسع، ويُبقي ارتفاعَه الأصلي فراغاً أبيضَ تحته. فالإطارُ كتلةٌ سقفُها عرضُ الصورة، والصورةُ 100% منه: تملأ سقفَها على
    // الشاشة العريضة وتنكمش على الضيقة. وحدٌّ رفيعٌ Temptress (ق10) يحفظ حافةَ البطاقة على متنٍ Beige. وOutlook يأخذ سمةَ العرض.
    const img = `<img src="${c.image.src}" width="${c.image.width}" height="${c.image.height}" alt="${esc(c.image.alt)}" style="display:block;border:0;width:100%;height:auto;border-radius:13px">`;
    const linked = c.image.href ? `<a href="${c.image.href}" style="display:block;text-decoration:none">${img}</a>` : img;
    r.push({ html: `<div class="t-frame" style="max-width:${c.image.width}px;margin:0 auto;border:1px solid ${LIGHT.frame};border-radius:14px;overflow:hidden;font-size:0;line-height:0">${linked}</div>`, top: 6, bottom: 18 });
  };
  if ((c.imageAt ?? "afterLead") === "afterLead") image();
  for (const p of c.paragraphs ?? []) r.push({ html: para(16, p), bottom: 12 });
  if (c.imageAt === "afterText") image();

  const facts = (c.facts ?? []).filter(([, v]) => v && v.trim());
  if (facts.length) {
    const fr = facts
      .map(
        ([k, v], i) => `<tr>
  <td class="t-muted t-rule" style="padding:10px 16px;${i ? `border-top:1px solid ${LIGHT.rule};` : ""}font-family:${FONT};font-size:13px;color:${LIGHT.muted};white-space:nowrap;vertical-align:top">${esc(k)}</td>
  <td class="t-text t-rule" align="left" style="padding:10px 16px;${i ? `border-top:1px solid ${LIGHT.rule};` : ""}font-family:${FONT};font-size:14px;font-weight:bold;color:${LIGHT.text};text-align:left;word-break:break-word;overflow-wrap:anywhere">${esc(v!.trim())}</td>
</tr>`
      )
      .join("");
    r.push({ html: `<table role="presentation" class="t-rule" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LIGHT.rule};border-radius:14px;border-collapse:separate">${fr}</table>`, top: 4, bottom: 16 });
  }
  if (c.quote?.text.trim()) {
    r.push({
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="t-text" style="border-right:4px solid ${B.mahogany};padding:10px 16px;font-family:${FONT};font-size:15px;line-height:1.85;color:${LIGHT.text}">
${c.quote.label ? `<div style="font-size:12px;font-weight:bold;margin-bottom:4px">${esc(c.quote.label)}</div>` : ""}<div style="white-space:pre-wrap">${esc(c.quote.text.trim())}</div></td></tr></table>`,
      bottom: 16,
    });
  }
  if (c.code) {
    // الرمزُ بخطّ الرسالة نفسه (لا خطٌّ ثالث) بأرقامٍ متساوية العرض — في صندوقٍ **بحدٍّ لا بتعبئة**: لا خلفيةَ يقلبها عميلُ البريد
    r.push({
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="t-code" align="center" style="border:2px solid ${B.mahogany};border-radius:16px;padding:18px 12px">
<div class="t-text" dir="ltr" style="font-family:${FONT};font-size:38px;font-weight:bold;letter-spacing:10px;font-variant-numeric:tabular-nums;color:${LIGHT.text}">${esc(c.code.value)}</div>
${c.code.caption ? `<div class="t-muted" style="margin-top:6px;font-family:${FONT};font-size:13px;color:${LIGHT.muted}">${esc(c.code.caption)}</div>` : ""}</td></tr></table>`,
      top: 4,
      bottom: 16,
    });
  }
  if (c.cta || c.secondary) {
    const btn = c.cta
      ? `<a href="${c.cta.url}" class="t-btn" style="display:inline-block;background-color:${B.temptress};color:${B.beige};font-family:${FONT};font-size:16px;font-weight:bold;line-height:1.4;text-decoration:none;padding:13px 32px;border-radius:12px;border:1.5px solid ${B.temptress}">${esc(c.cta.label)}</a>`
      : "";
    const sec = c.secondary
      ? `<a href="${c.secondary.url}" class="t-btn2" style="display:inline-block;color:${B.temptress};font-family:${FONT};font-size:15px;font-weight:bold;line-height:1.4;text-decoration:none;padding:12px 24px;border-radius:12px;border:1.5px solid ${B.temptress};margin-top:10px">${esc(c.secondary.label)}</a>`
      : "";
    r.push({ html: `<div style="text-align:center">${btn}${btn && sec ? "<br>" : ""}${sec}</div>`, top: 4, bottom: 16 });
  }
  for (const p of c.after ?? []) r.push({ html: para(15, p), bottom: 8 });
  if (c.note) r.push({ html: `<p class="t-muted" style="${P(13, `line-height:1.75;text-align:center;color:${LIGHT.muted}`)}">${esc(c.note)}</p>`, top: 6, bottom: 0 });

  if (r.length) r[r.length - 1].bottom = 0;
  const rows = r.map((x) => `<tr><td style="padding:${x.top ?? 0}px 0 ${x.bottom}px">${x.html}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">${rows}</table>`;
}

export function renderEmail2026(opts: Parameters<typeof renderEmail2026Parts>[0]): string {
  return renderEmail2026Parts(opts).html;
}

export function renderEmail2026Parts(opts: {
  subject: string;
  content: EmailContent;
  theme?: EmailTheme;
  /** مصادرُ صور الهوية — `cid:` في البريد (الافتراضي)، وبياناتٌ مباشرة في ملفات المعاينة */
  images?: EmailImageSources;
  /** الترويسةُ المرسومة بجهتها وقتَ الإرسال (`emailHeader`) — وبغيابها القاعدةُ المولَّدة والجهةُ نصٌّ تحتها */
  headerSrc?: string;
  preheader?: string;
  /** التوقيعُ التعريفي وحساباتُ التواصل — من `emailBrand` (تُمرَّر فلا تدور الاستيرادات) */
  tagline?: string;
  links?: { label: string; url: string }[];
  handle?: string | null;
  /** جهةُ الرسالة في الترويسة (`emailSenderLabel`) — وبغيابها اسمُ القسم كما هو */
  senderLabel?: string | null;
}): { html: string; bodyHtml: string } {
  const img = opts.images ?? CID_IMAGE_SOURCES;
  const A = EMAIL_BRAND_ASSETS;
  const dept = opts.senderLabel?.trim() || opts.theme?.departmentName?.trim() || "إدارة TLAQI";
  const bodyHtml = body(opts.content);
  const tagline = opts.tagline ?? "نلتقي • نفكر • نصنع";
  const handle = opts.handle ? `@${opts.handle}` : "";

  // ── الترويسة: صورةٌ بجهتها، أو القاعدةُ والجهةُ نصٌّ تحتها
  const headerImg = (src: string, alt: string) =>
    `<img src="${src}" width="${A.headerBase.width}" height="${A.headerBase.height}" alt="${esc(alt)}" style="display:block;border:0;width:100%;height:auto;border-radius:20px">`;
  const headerRows = opts.headerSrc
    ? `<tr><td style="font-size:0;line-height:0">${headerImg(opts.headerSrc, `TLAQI — ${dept}`)}</td></tr>`
    : `<tr><td style="font-size:0;line-height:0">${headerImg(img.headerBase, "TLAQI")}</td></tr>
<tr><td class="t-pad" dir="rtl" style="padding:12px 6px 0;text-align:right"><span class="t-muted" style="font-family:${FONT};font-size:13px;font-weight:bold;color:${LIGHT.muted}">${esc(dept)}</span></td></tr>`;

  // ── الروابطُ وسطرُ الجهة: نصٌّ قابلٌ للنقر فوق صورة التذييل
  const dot = `<span class="t-muted" style="color:${LIGHT.muted};font-family:${FONT};font-size:13px;padding:0 8px">•</span>`;
  const links = (opts.links ?? [])
    .map((l) => `<a href="${esc(l.url)}" class="t-link" style="color:${LIGHT.link};text-decoration:none;font-family:${FONT};font-size:14px;font-weight:bold">${esc(l.label)}</a>`)
    .join(dot);

  const html = `<!doctype html>
<html dir="rtl" lang="ar" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(opts.subject)}</title>
<!--[if mso]><style>body,table,td,div,p,a,span,h1{font-family:Tahoma,Arial,sans-serif !important}</style><![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important}
@media (max-width:620px){ .t-pad{padding-left:4px!important;padding-right:4px!important} .t-btn,.t-btn2{display:block!important;text-align:center!important} }
@media (prefers-color-scheme:dark){
  .t-title{color:${DARK.title}!important} .t-text{color:${DARK.text}!important} .t-muted{color:${DARK.muted}!important} .t-link{color:${DARK.link}!important}
  .t-rule{border-color:${DARK.rule}!important} .t-frame{border-color:${DARK.frame}!important} .t-code{border-color:${DARK.title}!important}
  .t-btn{border-color:${B.beige}!important} .t-btn2{color:${B.beige}!important;border-color:${B.beige}!important}
}
[data-ogsc] .t-title{color:${DARK.title}!important} [data-ogsc] .t-text{color:${DARK.text}!important} [data-ogsc] .t-muted{color:${DARK.muted}!important}
[data-ogsc] .t-link{color:${DARK.link}!important} [data-ogsc] .t-btn{color:${B.beige}!important;border-color:${B.beige}!important} [data-ogsb] .t-btn{background-color:${B.temptress}!important}
[data-ogsc] .t-btn2{color:${B.beige}!important;border-color:${B.beige}!important}
</style>
</head>
<body style="margin:0;padding:0;width:100%;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(opts.preheader ?? opts.subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-family:${FONT}">
<tr><td align="center" style="padding:12px 10px 20px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
${headerRows}
<tr><td class="t-pad" dir="rtl" style="padding:28px 6px 6px;text-align:right">${bodyHtml}</td></tr>
<tr><td class="t-pad" align="center" style="padding:26px 6px 18px;text-align:center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="t-rule" style="border-top:1px solid ${LIGHT.rule};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>
${links ? `<div dir="ltr" style="margin-top:16px;line-height:1.8">${links}</div>` : ""}
<div class="t-muted" style="margin-top:6px;font-family:${FONT};font-size:12px;line-height:1.7;color:${LIGHT.muted}">مُرسَلة من إدارة تلاق لأن لك حساباً في منصّتها الداخلية.</div>
</td></tr>
<tr><td style="font-size:0;line-height:0"><img src="${img.footer}" width="${A.footer.width}" height="${A.footer.height}" alt="${esc(`TLAQI — ${tagline}${handle ? ` — ${handle}` : ""}`)}" style="display:block;border:0;width:100%;height:auto;border-radius:20px"></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
  return { html, bodyHtml };
}
