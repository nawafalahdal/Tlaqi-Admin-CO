import type { EmailContent, EmailTheme } from "@/lib/emailBrand";
import { HEX, EMAIL_FONT_STACK } from "./tokens";
import { EMAIL_BRAND_ASSETS, type EmailBrandAssetKey } from "./emailAssets.generated";

/** **قالبُ البريد — هوية تلاق ممتدةً على الرسالة كلها** (طلب المؤسس، نوفمبر 2026: «لا إطارَ أبيض خارجي»).
 *
 *  **السببُ الجذري للإطار الأبيض كان في هذا القالب نفسه** — لا في لونِ عنصرٍ واحد: كانت الرسالةُ «بطاقةً عائمة» داخل صفحة:
 *  خلفيةُ صفحةٍ (`#FAF8F4`، ليست من ألوان الهوية) بحشوٍ 24px أعلاه و10px على جانبيه (50px وأكثر على الكمبيوتر)، وبطاقةٌ بحدٍّ
 *  وزوايا مستديرة متنُها أبيض `#FFFFFF`، وسطرُ «مُرسَلة من» خارج البطاقة يترك تحتها فراغاً. فتُبنى الآن **أشرطةً بعرض الشاشة**
 *  بلا صفحةٍ حولها ولا حدٍّ ولا حشوٍ خارجي:
 *
 *  1. الترويسة — Temptress: الشعارُ الرسمي يساراً وجهةُ الرسالة يميناً (اتجاهٌ صريح لا يقلبه عميلُ البريد).
 *  2. نمطُ «موهبة» الرسمي — Mahogany على Beige، يصل الترويسةَ بالمتن.
 *  3. المتن — **Beige** (الخلفيةُ الأساسية في ملف الهوية؛ نصُّ Temptress عليه 13.9:1).
 *  4. التذييل — Temptress: العلامةُ Mahogany، و«نلتقي • نفكر • نصنع»، والحساباتُ الرسمية، وجهةُ الإرسال — داخله لا تحته.
 *  وخلفيةُ الجسم Temptress: ما يلي التذييل في شاشةٍ أطول من الرسالة امتدادٌ له لا بياض.
 *  والمحتوى في عمودٍ أقصاه 600px يتوسّط الأشرطة (وجدولٌ ثابتٌ لـOutlook على ويندوز)، وعلى الجوال يملأ العرض.
 *
 *  **ما لا يملكه القالب:** تطبيقُ Gmail يحيط أيَّ رسالةٍ بهامشٍ أبيض من واجهته هو (نحو 14 نقطة في iOS) — خارج HTML الرسالة.
 *
 *  **الصور مضمّنةٌ بمعرّف `cid:`** (`emailAssets.generated.ts`) — كانت روابطَ خارجية فيرسم كلُّ عارضٍ يحجبها مربّعاً فارغاً.
 *  **والخط:** خطُّ النظام (Apple أولاً) ببدائل لكل جهاز، وجزءٌ خاصٌّ لـOutlook يفرض Tahoma (وإلا رسم Times New Roman).
 *  ولا خطَّ يُحمَّل من الخارج: Gmail لا يحمّله أصلاً، فكان الخطُّ يختلف من عميلٍ لآخر. */

const B = HEX;
const FONT = EMAIL_FONT_STACK;
const BODY_BG = B.beige;
const BAND_BG = B.temptress;

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** الأشرطةُ الداكنة تبقى داكنةً في Gmail: لا يقلب صورةَ الخلفية، فتُرسَم بتدرّجٍ من لونٍ واحد فوق اللون الصريح */
const KEEP_DARK = `background-image:linear-gradient(${B.temptress},${B.temptress});`;

/** مصادرُ صور الهوية: `cid:` في البريد (الافتراضي)، وبياناتٌ مباشرة في ملفات المعاينة */
export type EmailImageSources = Record<EmailBrandAssetKey, string>;
export const CID_IMAGE_SOURCES: EmailImageSources = {
  logo: `cid:${EMAIL_BRAND_ASSETS.logo.cid}`,
  pattern: `cid:${EMAIL_BRAND_ASSETS.pattern.cid}`,
  mark: `cid:${EMAIL_BRAND_ASSETS.mark.cid}`,
};

/** شهادةُ التعيين (رسالة قائد اللجنة) تُرسم بالبنية الموحَّدة نفسها: عنوانٌ وحقائقُ وبيانٌ وخطوات */
function normalize(c: EmailContent): EmailContent {
  const a = c.appointment;
  if (!a) return c;
  return {
    ...c,
    badge: c.badge ?? "قرار تعيين",
    title: c.title,
    lead: `<b>${esc(a.name)}</b> — ${esc(a.role)}`,
    // التاريخُ مرّةً واحدة: الحقائقُ تحمل «تاريخ التعيين» عادةً
    facts: a.facts.some(([k]) => k.includes("تاريخ")) ? a.facts : [...a.facts, ["التاريخ", a.date]],
    paragraphs: [esc(a.statement), `صدر التعيين من: <b>${esc(a.issuer.name)}</b>${a.issuer.title ? ` — ${esc(a.issuer.title)}` : ""}`],
    after: [`<b>${esc(a.steps.title)}</b>`, ...a.steps.items.map((s, i) => `${i + 1}. ${esc(s)}`)],
    note: a.note ?? c.note,
  };
}

/** صفُّ محتوى بمسافته بعده — والصفُّ الأخير بلا مسافةٍ بعده: لا فراغَ متراكمٌ بين آخر سطرٍ والتذييل */
type Row = { html: string; top?: number; bottom: number };

const P = (size: number, extra = "") => `margin:0;font-family:${FONT};font-size:${size}px;line-height:1.85;color:${B.temptress};${extra}`;

function body(raw: EmailContent): string {
  const c = normalize(raw);
  const r: Row[] = [];
  const badge = c.badge ?? { action: "إجراءٌ مطلوب", security: "أمان الحساب", celebrate: "تهنئة", info: "إشعار", alert: "تنبيه", farewell: "وداع" }[c.tone ?? "info"];
  r.push({ html: `<span style="display:inline-block;background-color:${B.temptress};color:${B.beige};font-family:${FONT};font-size:12px;font-weight:bold;line-height:1.5;padding:4px 14px;border-radius:999px">${esc(badge)}</span>`, bottom: 12 });
  if (raw.appointment) r.push({ html: `<div dir="ltr" style="font-family:${FONT};font-size:11px;letter-spacing:3px;color:${B.temptress};text-align:right">CERTIFICATE OF APPOINTMENT</div>`, bottom: 4 });
  r.push({ html: `<h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:1.45;font-weight:800;color:${B.mahogany}">${esc(c.title)}</h1>`, bottom: 10 });
  if (c.lead) r.push({ html: `<p style="${P(16)}">${c.lead}</p>`, bottom: 12 });

  const image = () => {
    if (!c.image) return;
    // في الوسط بعرضٍ ثابت: جدولٌ متمركز يرسمه Outlook كما يرسمه Gmail وApple Mail. وحدٌّ رفيعٌ Temptress (ق10) يحفظ حافةَ
    // البطاقة على متنٍ Beige (أعلاها Beige أيضاً)
    const img = `<img src="${c.image.src}" width="${c.image.width}" height="${c.image.height}" alt="${esc(c.image.alt)}" style="display:block;border:1px solid ${B.temptress};width:${c.image.width}px;max-width:100%;height:auto;border-radius:14px;margin:0 auto">`;
    const linked = c.image.href ? `<a href="${c.image.href}" style="text-decoration:none">${img}</a>` : img;
    r.push({ html: `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td align="center">${linked}</td></tr></table>`, top: 6, bottom: 18 });
  };
  if ((c.imageAt ?? "afterLead") === "afterLead") image();
  for (const p of c.paragraphs ?? []) r.push({ html: `<p style="${P(16)}">${p}</p>`, bottom: 12 });
  if (c.imageAt === "afterText") image();

  const facts = (c.facts ?? []).filter(([, v]) => v && v.trim());
  if (facts.length) {
    const fr = facts
      .map(
        ([k, v], i) => `<tr>
  <td style="padding:10px 16px;${i ? `border-top:1px solid ${B.temptress};` : ""}font-family:${FONT};font-size:13px;color:${B.temptress};white-space:nowrap;vertical-align:top">${esc(k)}</td>
  <td align="left" style="padding:10px 16px;${i ? `border-top:1px solid ${B.temptress};` : ""}font-family:${FONT};font-size:14px;font-weight:bold;color:${B.temptress};text-align:left;word-break:break-word;overflow-wrap:anywhere">${esc(v!.trim())}</td>
</tr>`
      )
      .join("");
    r.push({ html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${B.temptress};border-radius:14px;border-collapse:separate">${fr}</table>`, top: 4, bottom: 16 });
  }
  if (c.quote?.text.trim()) {
    r.push({
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-right:4px solid ${B.mahogany};padding:10px 16px;font-family:${FONT};font-size:15px;line-height:1.85;color:${B.temptress}">
${c.quote.label ? `<div style="font-size:12px;font-weight:bold;margin-bottom:4px">${esc(c.quote.label)}</div>` : ""}<div style="white-space:pre-wrap">${esc(c.quote.text.trim())}</div></td></tr></table>`,
      bottom: 16,
    });
  }
  if (c.code) {
    // الرمزُ بخطّ الرسالة نفسه (لا خطٌّ ثالث) بأرقامٍ متساوية العرض
    r.push({
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${B.temptress}" style="background-color:${B.temptress};${KEEP_DARK}border-radius:16px;padding:20px 12px">
<div dir="ltr" style="font-family:${FONT};font-size:38px;font-weight:bold;letter-spacing:10px;font-variant-numeric:tabular-nums;color:${B.beige}">${esc(c.code.value)}</div>
${c.code.caption ? `<div style="margin-top:6px;font-family:${FONT};font-size:13px;color:${B.beige}">${esc(c.code.caption)}</div>` : ""}</td></tr></table>`,
      top: 4,
      bottom: 16,
    });
  }
  if (c.cta || c.secondary) {
    const btn = c.cta
      ? `<a href="${c.cta.url}" class="t-btn" style="display:inline-block;background-color:${B.temptress};color:${B.beige};font-family:${FONT};font-size:16px;font-weight:bold;line-height:1.4;text-decoration:none;padding:14px 32px;border-radius:12px">${esc(c.cta.label)}</a>`
      : "";
    const sec = c.secondary
      ? `<a href="${c.secondary.url}" class="t-btn" style="display:inline-block;color:${B.temptress};font-family:${FONT};font-size:15px;font-weight:bold;line-height:1.4;text-decoration:none;padding:12px 24px;border-radius:12px;border:1.5px solid ${B.temptress};margin-top:10px">${esc(c.secondary.label)}</a>`
      : "";
    r.push({ html: `<div style="text-align:center">${btn}${btn && sec ? "<br>" : ""}${sec}</div>`, top: 4, bottom: 16 });
  }
  for (const p of c.after ?? []) r.push({ html: `<p style="${P(15)}">${p}</p>`, bottom: 8 });
  if (c.note) r.push({ html: `<p style="${P(13, "line-height:1.75;text-align:center")}">${esc(c.note)}</p>`, top: 6, bottom: 0 });

  if (r.length) r[r.length - 1].bottom = 0;
  const rows = r.map((x) => `<tr><td style="padding:${x.top ?? 0}px 0 ${x.bottom}px">${x.html}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">${rows}</table>`;
}

/** شريطٌ بعرض الشاشة بلونٍ واحد، ومحتواه في عمودٍ أقصاه 600px (وجدولٌ ثابتٌ لـOutlook على ويندوز) */
function band(bg: string, inner: string, opts: { pad: string; dark?: boolean; cls?: string }): string {
  return `<tr><td align="center" bgcolor="${bg}" style="background-color:${bg};${opts.dark ? KEEP_DARK : ""}padding:0">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td${opts.cls ? ` class="${opts.cls}"` : ""} style="padding:${opts.pad}">${inner}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`;
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
  preheader?: string;
  /** التوقيعُ التعريفي وحساباتُ التواصل — من `emailBrand` (تُمرَّر فلا تدور الاستيرادات) */
  tagline?: string;
  links?: { label: string; url: string }[];
  handle?: string | null;
  /** موقعُ المنصة الرسمي في التذييل */
  site?: { label: string; url: string } | null;
  /** جهةُ الرسالة في الترويسة (`emailSenderLabel`) — وبغيابها اسمُ القسم كما هو */
  senderLabel?: string | null;
}): { html: string; bodyHtml: string } {
  const img = opts.images ?? CID_IMAGE_SOURCES;
  const A = EMAIL_BRAND_ASSETS;
  const dept = opts.senderLabel?.trim() || opts.theme?.departmentName?.trim() || "إدارة TLAQI";
  const bodyHtml = body(opts.content);
  const linkStyle = `color:${B.beige};text-decoration:none;font-family:${FONT};font-size:13px;font-weight:bold`;
  const dot = `<span style="color:${B.beige};font-family:${FONT};font-size:13px;padding:0 8px">•</span>`;
  const links = [...(opts.links ?? []), ...(opts.site ? [opts.site] : [])]
    .map((l) => `<a href="${esc(l.url)}" style="${linkStyle}">${esc(l.label)}</a>`)
    .join(dot);

  const header = `<table role="presentation" dir="ltr" width="100%" cellpadding="0" cellspacing="0" border="0" style="direction:ltr"><tr>
  <td align="left" valign="middle" width="55%" style="text-align:left"><img src="${img.logo}" width="${A.logo.width}" height="${A.logo.height}" alt="TLAQI — Talent Link Advancing Quality Innovation" class="t-logo" style="display:block;border:0;width:${A.logo.width}px;max-width:100%;height:auto"></td>
  <td align="right" valign="middle" width="45%" dir="rtl" style="text-align:right;direction:rtl;font-family:${FONT};font-size:14px;line-height:1.5;font-weight:bold;color:${B.beige}">${esc(dept)}</td>
</tr></table>`;
  const footer = `<img src="${img.mark}" width="${A.mark.width}" height="${A.mark.height}" alt="TLAQI" style="display:block;border:0;width:${A.mark.width}px;height:auto;margin:0 auto 12px">
<div style="font-family:${FONT};font-size:16px;line-height:1.6;font-weight:bold;color:${B.beige}">${esc(opts.tagline ?? "نلتقي • نفكر • نصنع")}</div>
${links ? `<div dir="ltr" style="margin-top:12px;line-height:1.8">${links}</div>` : ""}
${opts.handle ? `<div dir="ltr" style="margin-top:2px;font-family:${FONT};font-size:12px;color:${B.beige}">@${esc(opts.handle)}</div>` : ""}
<div style="margin-top:14px;font-family:${FONT};font-size:12px;line-height:1.7;color:${B.beige}">مُرسَلة من إدارة تلاق لأن لك حساباً في منصّتها الداخلية.</div>`;

  const html = `<!doctype html>
<html dir="rtl" lang="ar" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(opts.subject)}</title>
<!--[if mso]><style>body,table,td,div,p,a,span,h1{font-family:Tahoma,Arial,sans-serif !important}</style><![endif]-->
<style>
html,body{margin:0!important;padding:0!important;width:100%!important;background-color:${BAND_BG}}
@media (max-width:620px){ .t-pad{padding-left:20px!important;padding-right:20px!important} .t-logo{width:150px!important} .t-btn{display:block!important;text-align:center!important} }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BAND_BG};font-family:${FONT}" bgcolor="${BAND_BG}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(opts.preheader ?? opts.subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BAND_BG}" style="width:100%;background-color:${BAND_BG};${KEEP_DARK}font-family:${FONT}">
${band(BAND_BG, header, { pad: "22px 24px", dark: true, cls: "t-pad" })}
${band(BODY_BG, `<img src="${img.pattern}" width="${A.pattern.width}" height="${A.pattern.height}" alt="" style="display:block;border:0;width:100%;max-width:${A.pattern.width}px;height:auto">`, { pad: "0" })}
${band(BODY_BG, bodyHtml, { pad: "22px 24px 30px", cls: "t-pad" })}
${band(BAND_BG, footer, { pad: "28px 24px 30px", dark: true, cls: "t-pad" }).replace('<td class="t-pad" style="', '<td class="t-pad" align="center" style="text-align:center;')}
</table>
</body>
</html>`;
  return { html, bodyHtml };
}
