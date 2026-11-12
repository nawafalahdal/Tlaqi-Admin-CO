import type { EmailContent, EmailTheme } from "@/lib/emailBrand";
import { HEX, TYPEFACE, BACKGROUNDS } from "./tokens";
import { readableTextOn } from "@/lib/colors";

/** **قالبُ البريد — هوية تلاق 2026 (معاينة).** يرسم المحتوى نفسَه الذي تبنيه دوالُّ الرسائل (`EmailContent`)
 *  — فلا تتغيّر روابطُها ولا متغيّراتُها ولا معناها — بتصميمٍ جديد من الحزمة وحدها:
 *
 *  - **الخلفيةُ بيضاء كما هي اليوم (قرار المؤسس)**، وفي العناصر الألوانُ الأربعة وحدها: النصُّ Temptress، والعنوانُ
 *    الكبير Mahogany، والشارةُ Green Sheen بنص Temptress (7.0:1)، والحدودُ Temptress رفيعة.
 *  - **الترويسة:** Temptress بالشعار الرسمي «على الداكن» (صورةٌ من ملفه، لا رسم)، ثم **شريطُ النمط**
 *    «موهبة» بلون Mahogany على الأبيض مستقلاً (لا نمطَ خلف نص).
 *  - **الأزرار (ق9):** الأساسي Temptress بنص Beige، والثانوي حدٌّ Temptress.
 *  - **الخط (ق1، ق8):** The Year of The Camel أولاً، وTahoma/Arial احتياطاً — أغلبُ العملاء لا يحمّلون الخط.
 *  - **التذييل:** العلامة، والتوقيعُ التعريفي الرسمي «تحوّل رقمي، برؤية طموحة.» (قرار المؤسس)، والحسابات، و«إدارة تلاق».
 *  - **الجوال:** عرضٌ أقصى 600 ومرونةٌ دونه، وأزرارٌ بعرضٍ كامل على الشاشات الصغيرة.
 *
 *  **وهو قالبُ الإرسال على فرع التطوير** (`renderEmail` في `emailBrand.ts`) لمراجعة المؤسس على المعاينة قبل الاعتماد
 *  النهائي؛ والقالبُ السابق محفوظٌ باسم `renderEmailLegacy` للرجوع. */

const B = HEX;
const FONT = `'${TYPEFACE.family}',${TYPEFACE.fallback.replace(/, /g, ",")}`;

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** الترويسةُ والتذييلُ يبقيان داكنين في Gmail: لا يقلب صورةَ الخلفية، فتُرسَم بتدرّجٍ من لونٍ واحد فوق اللون الصريح */
const KEEP_DARK = `background-image:linear-gradient(${HEX.temptress},${HEX.temptress});`;

const row = (html: string, pad = "0 0 16px") => `<tr><td style="padding:${pad}">${html}</td></tr>`;

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

function body(raw: EmailContent): string {
  const c = normalize(raw);
  const r: string[] = [];
  const badge = c.badge ?? { action: "إجراءٌ مطلوب", security: "أمان الحساب", celebrate: "تهنئة", info: "إشعار", alert: "تنبيه", farewell: "وداع" }[c.tone ?? "info"];
  r.push(row(`<span style="display:inline-block;background-color:${B.greenSheen};color:${B.temptress};font-family:${FONT};font-size:12px;font-weight:bold;padding:5px 14px;border-radius:999px">${esc(badge)}</span>`, "0 0 14px"));
  if (raw.appointment) r.push(row(`<div dir="ltr" style="font-family:${FONT};font-size:11px;letter-spacing:3px;color:${B.temptress};text-align:right">CERTIFICATE OF APPOINTMENT</div>`, "0 0 6px"));
  r.push(row(`<h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:1.5;font-weight:800;color:${B.mahogany}">${esc(c.title)}</h1>`, "0 0 10px"));
  if (c.lead) r.push(row(`<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.9;color:${B.temptress}">${c.lead}</p>`, "0 0 18px"));
  if (c.image) {
    const img = `<img src="${c.image.src}" width="${c.image.width}" height="${c.image.height}" alt="${esc(c.image.alt)}" style="display:block;border:0;width:100%;max-width:${c.image.width}px;height:auto;border-radius:14px">`;
    r.push(row(c.image.href ? `<a href="${c.image.href}" style="text-decoration:none">${img}</a>` : img, "0 0 20px"));
  }
  for (const p of c.paragraphs ?? []) r.push(row(`<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.95;color:${B.temptress}">${p}</p>`));
  const facts = (c.facts ?? []).filter(([, v]) => v && v.trim());
  if (facts.length) {
    const fr = facts
      .map(
        ([k, v], i) => `<tr>
  <td style="padding:11px 16px;${i ? `border-top:1px solid ${B.temptress};` : ""}font-family:${FONT};font-size:13px;color:${B.temptress};white-space:nowrap;vertical-align:top">${esc(k)}</td>
  <td align="left" style="padding:11px 16px;${i ? `border-top:1px solid ${B.temptress};` : ""}font-family:${FONT};font-size:14px;font-weight:bold;color:${B.temptress};text-align:left;word-break:break-word;overflow-wrap:anywhere">${esc(v!.trim())}</td>
</tr>`
      )
      .join("");
    r.push(row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${B.temptress};border-radius:14px;border-collapse:separate">${fr}</table>`, "4px 0 18px"));
  }
  if (c.quote?.text.trim()) {
    r.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-right:4px solid ${B.mahogany};padding:12px 16px;font-family:${FONT};font-size:14px;line-height:1.9;color:${B.temptress}">
${c.quote.label ? `<div style="font-size:12px;font-weight:bold;margin-bottom:4px">${esc(c.quote.label)}</div>` : ""}<div style="white-space:pre-wrap">${esc(c.quote.text.trim())}</div></td></tr></table>`,
        "0 0 18px"
      )
    );
  }
  if (c.code) {
    r.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${B.temptress}" style="background-color:${B.temptress};border-radius:16px;padding:22px 12px">
<div dir="ltr" style="font-family:'Courier New',Consolas,monospace;font-size:38px;font-weight:bold;letter-spacing:10px;color:${B.beige}">${esc(c.code.value)}</div>
${c.code.caption ? `<div style="margin-top:8px;font-family:${FONT};font-size:12px;color:${B.beige}">${esc(c.code.caption)}</div>` : ""}</td></tr></table>`,
        "4px 0 18px"
      )
    );
  }
  if (c.cta || c.secondary) {
    const btn = c.cta
      ? `<a href="${c.cta.url}" class="b26-btn" style="display:inline-block;background-color:${B.temptress};color:${B.beige};font-family:${FONT};font-size:15px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:12px">${esc(c.cta.label)}</a>`
      : "";
    const sec = c.secondary
      ? `<a href="${c.secondary.url}" class="b26-btn" style="display:inline-block;color:${B.temptress};font-family:${FONT};font-size:14px;font-weight:bold;text-decoration:none;padding:12px 24px;border-radius:12px;border:1.5px solid ${B.temptress};margin-top:10px">${esc(c.secondary.label)}</a>`
      : "";
    r.push(row(`<div style="text-align:center">${btn}${btn && sec ? "<br>" : ""}${sec}</div>`, "6px 0 18px"));
  }
  for (const p of c.after ?? []) r.push(row(`<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.9;color:${B.temptress}">${p}</p>`, "0 0 10px"));
  if (c.note) r.push(row(`<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.8;color:${B.temptress};text-align:center">${esc(c.note)}</p>`, "6px 0 0"));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl">${r.join("")}</table>`;
}

export function renderEmail2026(opts: Parameters<typeof renderEmail2026Parts>[0]): string {
  return renderEmail2026Parts(opts).html;
}

export function renderEmail2026Parts(opts: {
  subject: string;
  content: EmailContent;
  theme?: EmailTheme;
  /** مسارُ الأصول: في المعاينة مجلّدُ الحزمة محلياً، وبعد الاعتماد عنوانُ المنصة العام */
  assetBase: string;
  /** في المعاينة وحدها: تحميلُ الخط المعتمد لرؤية القصد (أغلبُ العملاء لا يحمّلونه — ق1، ق8) */
  fontFaceBase?: string | null;
  preheader?: string;
  /** التوقيعُ التعريفي وحسابُ التواصل — من `emailBrand` (يُمرَّران فلا تدور الاستيرادات) */
  tagline?: string;
  handle?: string | null;
}): { html: string; bodyHtml: string } {
  const a = (p: string) => `${opts.assetBase}/${p}`;
  const dept = opts.theme?.departmentName?.trim();
  const fontFace = opts.fontFaceBase
    ? TYPEFACE.weights.map((w) => `@font-face{font-family:'${TYPEFACE.family}';src:url('${opts.fontFaceBase}/${w.file}') format('opentype');font-weight:${w.weight};font-display:swap}`).join("")
    : "";
  const bodyHtml = body(opts.content);
  // **لونُ القسم كاملاً (قرار المؤسس):** رسالةٌ تخصّ قسماً أو لجنة تحمل شريطاً بلونه واسمه تحت الترويسة — واللجنةُ
  // بلون قسمها (يُحلّ قبل الوصول هنا). والحبرُ بالتباين، والتدرّجُ نفسُه يحميه من قلب Gmail الداكن
  const deptColor = opts.theme?.colorHex?.trim();
  const deptInk = deptColor ? readableTextOn(deptColor) : "";
  const deptBand = dept && deptColor
    ? `<tr><td bgcolor="${deptColor}" style="background-color:${deptColor};background-image:linear-gradient(${deptColor},${deptColor});padding:10px 26px;font-family:${FONT};font-size:14px;font-weight:bold;color:${deptInk}">${esc(dept)}</td></tr>`
    : dept
      ? `<tr><td style="padding:10px 26px 0;font-family:${FONT};font-size:13px;font-weight:bold;color:${B.temptress}">${esc(dept)}</td></tr>`
      : "";
  const handle = opts.handle;
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(opts.subject)}</title>
<style>
${fontFace}
@media (max-width:620px){ .b26-card{border-radius:0!important;border-left:0!important;border-right:0!important} .b26-pad{padding:22px 18px!important} .b26-btn{display:block!important;text-align:center!important} }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BACKGROUNDS.emailPage}" bgcolor="${BACKGROUNDS.emailPage}">
<div style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader ?? opts.subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BACKGROUNDS.emailPage}" style="background-color:${BACKGROUNDS.emailPage};padding:24px 0">
<tr><td align="center" style="padding:0 10px">
  <table role="presentation" class="b26-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BACKGROUNDS.emailCard}" style="max-width:600px;background-color:${BACKGROUNDS.emailCard};border:1px solid ${B.temptress};border-radius:20px;overflow:hidden">
    <tr><td bgcolor="${B.temptress}" style="background-color:${B.temptress};${KEEP_DARK}padding:22px 26px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="right"><img src="${a("email/logo-on-temptress.png")}" width="200" height="59" alt="TLAQI — Talent Link Advancing Quality Innovation" style="display:block;border:0;width:200px;height:auto"></td>
      </tr></table>
    </td></tr>
    ${deptBand}
    <tr><td style="font-size:0;line-height:0;padding:0"><img src="${a("email/pattern-talent-on-white.png")}" width="600" height="48" alt="" style="display:block;border:0;width:100%;height:auto"></td></tr>
    <tr><td style="height:1px;background-color:${B.temptress};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td class="b26-pad" style="padding:28px 30px 24px">${bodyHtml}</td></tr>
    <tr><td bgcolor="${B.temptress}" align="center" style="background-color:${B.temptress};${KEEP_DARK}padding:22px 24px 18px">
      <img src="${a("email/mark-mahogany.png")}" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:auto;margin:0 auto 10px">
      <div style="font-family:${FONT};font-size:14px;font-weight:bold;color:${B.beige}">${esc(opts.tagline ?? "تحوّل رقمي، برؤية طموحة.")}</div>
      ${handle ? `<div dir="ltr" style="font-family:${FONT};font-size:11px;color:${B.beige};margin-top:10px">@${esc(handle)}</div>` : ""}
    </td></tr>
  </table>
  <div style="max-width:600px;margin:14px auto 0;font-family:${FONT};font-size:11px;line-height:1.8;color:${B.temptress};text-align:center">
    مُرسَلة من إدارة تلاق — لأن لك حساباً في منصّتها الداخلية.
  </div>
</td></tr>
</table>
</body>
</html>`;
  return { html, bodyHtml };
}
