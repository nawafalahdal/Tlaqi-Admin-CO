/** هوية رسائل البريد: الترويسة والبانر والتذييل.
 *
 *  كل رسالة تخرج من المنصة تمرّ من هنا، فتتّحد هويتها ولا تُكتب مرتين.
 *  القواعد التي يفرضها هذا الملف ليست تجميلاً: عملاء البريد (Gmail،
 *  Outlook) يتجاهلون <style> و CSS الحديث، فالتنسيق كله inline وداخل
 *  جداول — وهي الطريقة الوحيدة التي تُرسم بها الرسالة كما كُتبت.
 */

import { liftForDark, readableTextOn } from "@/lib/colors";

const BRAND = {
  temptress: "#341D2B",
  mahogany: "#C34900",
  beige: "#EEF6DF",
  greenSheen: "#67C090",
  ink: "#1A1023",
  paper: "#FAF8F4",
};

export function appBaseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

/** الشعار يُستضاف على النطاق نفسه ويُشار إليه برابط مطلق: عميل البريد
 *  لا يعرف موقعنا، والرابط النسبي يصل إليه مكسوراً. */
function assetUrl(path: string) {
  return `${appBaseUrl()}${path}`;
}

/** أنواع الرسائل الأربعة.
 *
 *  الهوية واحدة في كل رسالة — الشعار والجملة والتذييل لا تتغيّر — لكن
 *  نبرتها تتغيّر. التذكرة التي تحتاج إجراءً يجب أن تُعرف من نظرة واحدة في
 *  صندوق وارد مزدحم، ورسالة الشهادة لا تُرسل بنبرة الإنذار. */
export type EmailVariant =
  | "default"
  | "ticket"
  | "celebration"
  | "serious"
  | "security"
  | "welcome"
  | "share"
  | "farewell";

/** يربط نوع الرسالة بتصميمها.
 *
 *  المفتاح هو الوسم الذي تمرّره كل دالة إرسال أصلاً، فلا تحتاج أي دالة
 *  أن تعرف شيئاً عن التصميم. وما لا يُذكر هنا يأخذ التصميم العام: رسالة
 *  بلا هوية مستحيلة لا مستبعدة. */
const KIND_VARIANT: Record<string, EmailVariant> = {
  // التذاكر والطلبات — عمل له مهلة
  "تذكرة جديدة": "ticket",
  "تصعيد تذكرة": "ticket",
  "حل تذكرة": "ticket",
  "طلب اعتماد": "ticket",
  "قرار اعتماد": "ticket",
  "سحب تذكرة": "ticket",
  "تذكير تذكرة": "ticket",
  "تذكير طلب": "ticket",
  "تكليف اجتماع شرح": "ticket",
  // اللجان: قرارٌ إداريٌّ له طالبٌ ومعتمِد — من جنس طلبات الاعتماد
  "طلب لجنة": "ticket",
  "قرار لجنة": "ticket",
  // ردُّ تسليمٍ للتصحيح: عملٌ له مهلةٌ يُعاد — من جنس التذاكر لا الإنذار
  "ردّ تسليم": "ticket",
  "اجتماع شرح": "ticket",

  // ما يُفرح
  "طلب ينتظر الاعتماد": "ticket",
  "طلب توقيع": "ticket",
  "طلب إنهاء إدارة": "serious",
  "قرار إنهاء إدارة": "serious",
  "شهادة إتمام": "celebration",
  "تقدير ثلاثة أشهر": "celebration",
  // التكريم على إنجاز: احتفاءٌ بأثرٍ وقع — فيأخذ تصميم الاحتفاء لا العام
  "تكريم إنجاز": "celebration",
  "إعادة فتح الاختبار": "celebration",

  // ما يُسجَّل ويُحاسَب عليه
  تنبيه: "serious",
  "إنهاء عضوية": "serious",
  "عدم اجتياز الاختبار": "serious",
  "تذكير قبل سقوط المهلة": "serious",

  // الانضمام والوداع
  "ترحيب": "welcome",
  "ختام التجربة": "farewell",

  // الأمن
  "رمز الدخول": "security",
  "تذكير التحقق الثنائي": "security",

  // العام: الدعوة والدخول والاستعادة والإعلانات
  دعوة: "default",
  "بيانات الدخول": "default",
  "استعادة كلمة المرور": "default",
  "إعلان عام": "default",
};

export function variantForKind(kind: string): EmailVariant {
  return KIND_VARIANT[kind] ?? "default";
}

/** الجملة التي تُذيَّل بها كل رسالة. تُضبط من البيئة ليُغيّرها صاحب
 *  المنصة دون نشر جديد. */
export const TAGLINE = process.env.BRAND_TAGLINE || "نلتقي · نفكّر · نصنع";

/** الوسمُ الرسمي — جملتُنا نفسُها وسماً (قرار المؤسس)، لا «#تلاقي».
 *
 *  يُشتقّ من الشعار فلا يفترقان: الفواصلُ شرطاتٌ سفلية، والتشكيلُ يُنزَع —
 *  الوسمُ المشكولُ لا يطابق ما يكتبه الناس في المنصّات فيضيع. ويُضبط من
 *  البيئة (`BRAND_HASHTAG`) إن أُريد غيرُه دون نشرٍ جديد. */
export const BRAND_HASHTAG =
  process.env.BRAND_HASHTAG ||
  "#" +
    TAGLINE.replace(/[\u064B-\u0652]/g, "")
      .split("·")
      .map((w) => w.trim())
      .filter(Boolean)
      .join("_");

/** حسابات التواصل. تُقرأ من البيئة لأنها تتغيّر ولا يصحّ تخمينها:
 *  رابط حساب خاطئ في بريد رسمي أسوأ من غياب الرابط. الصفّ كله لا يُرسم
 *  ما لم يُضبط منها شيء. */
/** اليوزر موحّد على المنصات الثلاث. يبقى قابلاً للضبط من البيئة لتغييره
 *  دون نشر، وأي منصة يُفرَّغ يوزرها تختفي من الصفّ من تلقاء نفسها. */
const UNIFIED_HANDLE = "tlaqisa";

/** المعرّف الموحّد كما يُكتب في القوالب */
export const SOCIAL_HANDLE = UNIFIED_HANDLE;

export const SOCIAL_LINKS: { label: string; handle: string; url: string }[] = [
  { label: "X", handle: process.env.SOCIAL_X ?? UNIFIED_HANDLE, url: "https://x.com/" },
  {
    label: "Instagram",
    handle: process.env.SOCIAL_INSTAGRAM ?? UNIFIED_HANDLE,
    url: "https://instagram.com/",
  },
  {
    label: "LinkedIn",
    handle: process.env.SOCIAL_LINKEDIN ?? UNIFIED_HANDLE,
    url: "https://linkedin.com/company/",
  },
  // لا حساب تيك توك حالياً — يُضاف بضبط SOCIAL_TIKTOK وحده
  { label: "TikTok", handle: process.env.SOCIAL_TIKTOK ?? "", url: "https://tiktok.com/@" },
].filter((s) => s.handle.trim().length > 0);

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** نبرةُ الرسالة — تُقرأ من شارتها قبل عنوانها.
 *
 *  التذكرة التي تحتاج إجراءً يجب أن تُعرف من نظرةٍ في صندوقٍ مزدحم،
 *  ورسالةُ الشهادة لا تُرسَل بنبرة الإنذار. */
export type EmailTone = "action" | "security" | "celebrate" | "info" | "alert" | "farewell";

const TONE: Record<EmailTone, { badge: string; bg: string; fg: string }> = {
  action: { badge: "إجراء مطلوب", bg: "#FCE9DC", fg: "#8C3600" },
  security: { badge: "أمان الحساب", bg: "#EFE7EC", fg: BRAND.temptress },
  celebrate: { badge: "تهنئة", bg: "#E1F3E8", fg: "#2A6B47" },
  info: { badge: "للعلم", bg: "#EEF3E2", fg: "#4D5A33" },
  alert: { badge: "تنبيه", bg: "#FBE3DE", fg: "#8C2F1B" },
  farewell: { badge: "شكراً لِما قدّمت", bg: "#EFE7EC", fg: BRAND.temptress },
};

/** السمة الداكنة للرسائل — لوحٌ مستقلٌّ لا قلبٌ آليٌّ للفاتح.
 *
 *  **ما رأيناه في Gmail الداكن:** العميلُ يقلب الألوان بنفسه، فصارت الترويسةُ
 *  البنفسجية الداكنة ورديّةً فاتحة، وذاب عليها الشعارُ الفاتح. فللرسالة الآن
 *  طبقتان:
 *  - **عملاءٌ يحترمون `prefers-color-scheme`** (Apple Mail وiOS Mail وOutlook):
 *    هذا اللوحُ بعينه — أرضيةٌ غرافيتية، وبطاقةٌ أفتح بدرجة، وحبرٌ فاتح،
 *    وألوانُ الأقسام مرفوعةً حتى تُقرأ (`liftForDark`).
 *  - **عملاءٌ يقلبون الألوان قسراً** (Gmail): الترويسةُ والتذييلُ يُرسمان
 *    بـ`background-image` (لا يقلبها Gmail)، ونصوصُهما محميّةٌ بمزج
 *    `screen/difference` فتبقى فاتحةً على الداكن. */
const DARK = {
  page: "#121416",
  card: "#1C1F23",
  panel: "#24282D",
  line: "#2F343B",
  ink: "#ECEEF0",
  body: "#C9CDD2",
  muted: "#9AA0A8",
};
const TONE_DARK: Record<EmailTone, { bg: string; fg: string }> = {
  action: { bg: "#3A2418", fg: "#F6A06E" },
  security: { bg: "#2A2D24", fg: "#EEF6DF" },
  celebrate: { bg: "#1C3427", fg: "#93DBB2" },
  info: { bg: "#283021", fg: "#CBD9AC" },
  alert: { bg: "#3B201B", fg: "#F5A897" },
  farewell: { bg: "#2A2D24", fg: "#EEF6DF" },
};

/** النبرة الافتراضية لكلّ تصميم — إن لم تحدّدها الرسالة بنفسها */
export function toneForVariant(v: EmailVariant): EmailTone {
  switch (v) {
    case "ticket":
      return "action";
    case "celebration":
    case "welcome":
    case "share":
      return "celebrate";
    case "serious":
      return "alert";
    case "security":
      return "security";
    case "farewell":
      return "farewell";
    default:
      return "info";
  }
}

/** لونُ القسم في الرسالة: الشريط تحت الترويسة، والزرّ، وحدُّ الاقتباس.
 *
 *  القسمُ من سجلّ المستلِم أو من موضوع الرسالة — ولا يُخمَّن. ومن لا قسم
 *  له يأخذ المهوجني، لونَ الفعل في الهوية. */
export type EmailTheme = { departmentName?: string | null; colorHex?: string | null };

/** محتوى الرسالة — بنيةٌ لا HTML.
 *
 *  كانت كلُّ دالة إرسالٍ تكتب HTML بيدها: فقرةٌ هنا وزرٌّ بلونٍ هناك،
 *  والحقولُ سطورٌ متتالية بلا ترتيب. فصار المتنُ بياناتٍ يرسمها قالبٌ
 *  واحد — فتتّحد الرسائل كلُّها شكلاً، ولا يُنسى في واحدةٍ تهريبٌ أو
 *  لون.
 *
 *  **ما يُهرَّب وما لا يُهرَّب:** الحقولُ النصّية (`title`, `facts`,
 *  `quote`, `code`, `note`, `cta.label`) يُهرّبها القالب. أما `lead` و
 *  `paragraphs` و`after` فـHTML يكتبه المُرسِل، ويُهرِّب فيه بنفسه كلَّ
 *  ما جاء من مستخدم. */
export type EmailContent = {
  tone?: EmailTone;
  /** نصُّ الشارة إن خالف نصَّ النبرة */
  badge?: string;
  title: string;
  lead?: string;
  paragraphs?: string[];
  /** صورةٌ في رأس المتن (ملصق الدعوة، بطاقة العضوية) */
  image?: { src: string; width: number; height: number; alt: string; href?: string };
  facts?: Array<[string, string | null | undefined]>;
  quote?: { label?: string; text: string } | null;
  code?: { value: string; caption?: string };
  cta?: { label: string; url: string } | null;
  /** زرٌّ ثانٍ بحدٍّ لا بتعبئة — لما يلي الفعل الأساسي */
  secondary?: { label: string; url: string } | null;
  after?: string[];
  /** سطرٌ صغير أخير: مهلة، أو تحذيرٌ من التصيّد */
  note?: string | null;
};

const FONT_STACK = "Tahoma,Arial,sans-serif";

function accentOf(theme?: EmailTheme) {
  const c = theme?.colorHex?.trim() || BRAND.mahogany;
  // «فاتحٌ جداً» لا «فاتح»: الأخضر يُقرأ عليه بالداكن لكنه زرٌّ ظاهرٌ على
  // الأبيض، والبيج وحده يذوب فيه
  const h = c.replace("#", "");
  const lum =
    (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255;
  const light = lum > 0.85;
  return {
    rule: c,
    // زرٌّ بيجٌ على ورقةٍ بيضاء لا يُرى: فلون القسم الفاتح يأخذ زرَّ
    // الهوية الداكن، ويبقى لونُه في الشريط تحت الترويسة
    button: light ? BRAND.temptress : c,
    buttonInk: light ? BRAND.beige : readableTextOn(c),
    quote: light ? BRAND.mahogany : c,
  };
}

function block(html: string, pad = "0 0 14px"): string {
  return `<tr><td style="padding:${pad}">${html}</td></tr>`;
}

function renderBody(c: EmailContent, theme?: EmailTheme): string {
  const tone = TONE[c.tone ?? "info"];
  const a = accentOf(theme);
  const rows: string[] = [];

  rows.push(
    block(
      `<span class="tq-badge-${c.tone ?? "info"}" style="display:inline-block;background-color:${tone.bg};color:${tone.fg};font-family:${FONT_STACK};font-size:12px;font-weight:bold;padding:5px 14px;border-radius:999px">${esc(c.badge ?? tone.badge)}</span>`,
      "0 0 12px"
    )
  );
  rows.push(
    block(
      `<h1 class="tq-ink" style="margin:0;font-family:${FONT_STACK};font-size:22px;line-height:1.5;font-weight:bold;color:${BRAND.ink}">${esc(c.title)}</h1>`,
      "0 0 8px"
    )
  );
  if (c.lead) {
    rows.push(block(`<p class="tq-body" style="margin:0;font-size:15px;line-height:1.9;color:#3D3745">${c.lead}</p>`, "0 0 18px"));
  }
  if (c.image) {
    const img = `<img src="${c.image.src}" width="${c.image.width}" height="${c.image.height}" alt="${esc(c.image.alt)}" style="display:block;border:0;width:100%;max-width:${c.image.width}px;height:auto;border-radius:16px">`;
    rows.push(block(c.image.href ? `<a href="${c.image.href}" style="text-decoration:none">${img}</a>` : img, "0 0 20px"));
  }
  for (const p of c.paragraphs ?? []) {
    rows.push(block(`<p class="tq-ink" style="margin:0;font-size:15px;line-height:1.9;color:${BRAND.ink}">${p}</p>`));
  }

  const facts = (c.facts ?? []).filter(([, v]) => v && v.trim());
  if (facts.length) {
    const fr = facts
      .map(
        ([k, v], i) => `<tr>
          <td class="tq-muted tq-line" style="padding:11px 16px;${i ? "border-top:1px solid #EEEAE4;" : ""}font-size:13px;color:#7A7280;white-space:nowrap;vertical-align:top">${esc(k)}</td>
          <td class="tq-ink tq-line" align="left" style="padding:11px 16px;${i ? "border-top:1px solid #EEEAE4;" : ""}font-size:14px;font-weight:bold;color:${BRAND.ink};text-align:left">${esc(v!.trim())}</td>
        </tr>`
      )
      .join("");
    rows.push(
      block(
        `<table role="presentation" class="tq-line" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E7E2DB;border-radius:14px;border-collapse:separate">${fr}</table>`,
        "4px 0 18px"
      )
    );
  }

  if (c.quote?.text.trim()) {
    rows.push(
      block(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="tq-panel tq-ink" bgcolor="${BRAND.paper}" style="background-color:${BRAND.paper};border-right:4px solid ${a.quote};border-radius:10px;padding:13px 16px;font-size:14px;line-height:1.85;color:${BRAND.ink}">
            ${c.quote.label ? `<div class="tq-muted" style="font-size:12px;font-weight:bold;color:#7A7280;margin-bottom:4px">${esc(c.quote.label)}</div>` : ""}
            <div style="white-space:pre-wrap">${esc(c.quote.text.trim())}</div>
          </td></tr></table>`,
        "0 0 18px"
      )
    );
  }

  if (c.code) {
    rows.push(
      block(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" class="tq-code" bgcolor="${BRAND.beige}" style="background-color:${BRAND.beige};border-radius:16px;padding:22px 12px">
            <div dir="ltr" class="tq-ink" style="font-family:'Courier New',Consolas,monospace;font-size:38px;font-weight:bold;letter-spacing:10px;color:${BRAND.temptress}">${esc(c.code.value)}</div>
            ${c.code.caption ? `<div class="tq-muted" style="margin-top:8px;font-size:12px;color:#5E5A4E">${esc(c.code.caption)}</div>` : ""}
          </td></tr></table>`,
        "4px 0 18px"
      )
    );
  }

  if (c.cta || c.secondary) {
    const btn = c.cta
      ? `<a href="${c.cta.url}" class="tq-btn" style="display:inline-block;background-color:${a.button};color:${a.buttonInk};font-family:${FONT_STACK};font-size:15px;font-weight:bold;text-decoration:none;padding:13px 30px;border-radius:999px">${esc(c.cta.label)}</a>`
      : "";
    const sec = c.secondary
      ? `<a href="${c.secondary.url}" class="tq-sec" style="display:inline-block;color:${BRAND.temptress};font-family:${FONT_STACK};font-size:14px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:999px;border:1.5px solid rgba(52,29,43,0.25);margin-top:8px">${esc(c.secondary.label)}</a>`
      : "";
    rows.push(block(`<div style="text-align:center">${btn}${btn && sec ? "<br>" : ""}${sec}</div>`, "6px 0 16px"));
  }

  for (const p of c.after ?? []) {
    rows.push(block(`<p class="tq-body" style="margin:0;font-size:14px;line-height:1.85;color:#3D3745">${p}</p>`));
  }
  if (c.note) {
    rows.push(block(`<p class="tq-muted" style="margin:0;font-size:12px;line-height:1.8;color:#8A8390;text-align:center">${esc(c.note)}</p>`, "4px 0 0"));
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="font-family:${FONT_STACK}">${rows.join("")}</table>`;
}

/** الترويسةُ والتذييلُ يبقيان داكنين في Gmail: لا يقلب صورةَ الخلفية، فتُرسَم
 *  بتدرّجٍ من لونٍ واحد فوق اللون الصريح (ومن لا يدعم التدرّج يأخذ اللون). */
const KEEP_DARK = `background-image:linear-gradient(${BRAND.temptress},${BRAND.temptress});`;

/** نصٌّ فاتحٌ على ترويسةٍ داكنة يبقى فاتحاً حين يقلب Gmail الحبر.
 *
 *  `u + .body` لا يطابق إلا في Gmail (يُلحق `<u>` قبل المتن)، فالمزجُ لا يمسّ
 *  غيره: `screen` ثم `difference` فوق الأسود يُعيدان الحبرَ المقلوب إلى أصله. */
function keepLight(html: string): string {
  return `<span class="gm-s"><span class="gm-d">${html}</span></span>`;
}

/** أنماطُ السمة الداكنة — لمن يحترم `prefers-color-scheme` ولـOutlook (`data-ogsc`) */
function darkStyles(a: ReturnType<typeof accentOf>): string {
  const btn = liftForDark(a.button, 3);
  const accentInk = liftForDark(a.quote, 4.5);
  const rules = `
    .tq-page { background-color:${DARK.page} !important; }
    .tq-card { background-color:${DARK.card} !important; border-color:${DARK.line} !important; }
    .tq-ink { color:${DARK.ink} !important; }
    .tq-body { color:${DARK.body} !important; }
    .tq-muted { color:${DARK.muted} !important; }
    .tq-line { border-color:${DARK.line} !important; }
    .tq-panel { background-color:${DARK.panel} !important; border-right-color:${accentInk} !important; }
    .tq-code { background-color:${DARK.panel} !important; border:1px solid ${accentInk}55 !important; }
    .tq-btn { background-color:${btn} !important; color:${readableTextOn(btn)} !important; }
    .tq-sec { color:${accentInk} !important; border-color:${accentInk}66 !important; }
    .tq-fine { color:${DARK.muted} !important; }
    ${(Object.keys(TONE_DARK) as EmailTone[])
      .map((t) => `.tq-badge-${t} { background-color:${TONE_DARK[t].bg} !important; color:${TONE_DARK[t].fg} !important; }`)
      .join("\n    ")}`;
  return `@media (prefers-color-scheme: dark) {${rules}
  }
  [data-ogsc] .tq-ink { color:${DARK.ink} !important; }
  [data-ogsc] .tq-body { color:${DARK.body} !important; }
  [data-ogsc] .tq-muted { color:${DARK.muted} !important; }
  [data-ogsb] .tq-card { background-color:${DARK.card} !important; }
  [data-ogsb] .tq-page { background-color:${DARK.page} !important; }
  u + .body .gm-s { background:#000000; mix-blend-mode:screen; }
  u + .body .gm-d { background:#000000; mix-blend-mode:difference; }`;
}

/** الرسالة كاملةً بالقالب الموحَّد (المفهوم «أ» المعتمد).
 *
 *  ترويسةٌ داكنة فيها الشعار واسم القسم، ثم شريطٌ بلون القسم، ثم ورقةٌ
 *  بيضاء: شارةُ النبرة، والعنوان، والمتن، والحقول في جدول، والزرّ بلون
 *  القسم. ثم تذييلٌ داكن بالشعار والجملة والحسابات وشريط ألوان الهوية.
 *
 *  كلُّه جداول وأنماطٌ مضمَّنة: Gmail وOutlook يُسقطان `<style>` وCSS
 *  الحديث، وهذه وحدها تُرسَم كما كُتبت. */
export function renderEmail(opts: {
  subject: string;
  content: EmailContent;
  theme?: EmailTheme;
  preheader?: string;
}): { html: string; bodyHtml: string } {
  const a = accentOf(opts.theme);
  const bodyHtml = renderBody(opts.content, opts.theme);
  const dept = opts.theme?.departmentName?.trim();
  const sameHandle =
    SOCIAL_LINKS.length > 0 && SOCIAL_LINKS.every((s) => s.handle === SOCIAL_LINKS[0].handle);
  const social = SOCIAL_LINKS.map(
    (s) =>
      `<a href="${s.url}${esc(s.handle)}" style="color:${BRAND.beige};text-decoration:none;font-size:12px;opacity:0.85">${esc(s.label)}${sameHandle ? "" : ` @${esc(s.handle)}`}</a>`
  ).join(`<span style="color:rgba(238,246,223,0.35);padding:0 8px">·</span>`);

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  ${darkStyles(a)}
</style>
<title>${esc(opts.subject)}</title>
</head>
<body class="body tq-page" bgcolor="${BRAND.paper}" style="margin:0;padding:0;background-color:${BRAND.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader ?? opts.subject)}</div>
<table role="presentation" class="tq-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.paper}" style="background-color:${BRAND.paper};padding:24px 12px">
<tr><td align="center">
  <table role="presentation" class="tq-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;background-color:#ffffff;border-radius:20px;overflow:hidden;border:1px solid rgba(0,0,0,0.06)">
    <tr>
      <td bgcolor="${BRAND.temptress}" style="background-color:${BRAND.temptress};${KEEP_DARK}padding:18px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="right" style="font-size:0;line-height:0"><img src="${assetUrl("/brand/lockup-on-dark.png")}" width="118" height="35" alt="تَـــلاقِ — TLAQI" style="display:block;border:0;width:118px;height:35px"></td>
          <td align="left" style="font-family:${FONT_STACK};font-size:12px;font-weight:bold;color:rgba(238,246,223,0.72)">${dept ? keepLight(esc(dept)) : ""}</td>
        </tr></table>
      </td>
    </tr>
    <tr><td bgcolor="${a.rule}" style="height:5px;background-color:${a.rule};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td class="tq-card" bgcolor="#ffffff" style="background-color:#ffffff;padding:26px 28px 24px">${bodyHtml}</td></tr>
    <tr>
      <td align="center" bgcolor="${BRAND.temptress}" style="background-color:${BRAND.temptress};${KEEP_DARK}padding:22px 24px 16px">
        <img src="${assetUrl("/brand/lockup-on-dark.png")}" width="96" height="28" alt="TLAQI" style="display:block;border:0;width:96px;height:28px;margin:0 auto 10px">
        <div style="font-family:${FONT_STACK};font-size:13px;font-weight:bold;color:${BRAND.beige};letter-spacing:0.5px">${keepLight(esc(TAGLINE))}</div>
        ${social ? `<div dir="ltr" style="font-family:${FONT_STACK};margin-top:10px">${keepLight(social)}</div>` : ""}
        ${sameHandle ? `<div dir="ltr" style="font-family:${FONT_STACK};font-size:11px;color:rgba(238,246,223,0.55);margin-top:4px">${keepLight("@" + esc(SOCIAL_LINKS[0].handle))}</div>` : ""}
      </td>
    </tr>
    <tr><td style="font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="${BRAND.greenSheen}" style="height:5px;background-color:${BRAND.greenSheen}">&nbsp;</td>
      <td bgcolor="${BRAND.mahogany}" style="height:5px;background-color:${BRAND.mahogany}">&nbsp;</td>
      <td bgcolor="${BRAND.beige}" style="height:5px;background-color:${BRAND.beige}">&nbsp;</td>
    </tr></table></td></tr>
  </table>
  <div class="tq-fine" style="max-width:600px;margin:14px auto 0;font-family:${FONT_STACK};font-size:11px;line-height:1.8;color:rgba(0,0,0,0.45);text-align:center">
    مُرسَلة من إدارة تَـــلاقِ — لأن لك حساباً في منصّتها الداخلية.
  </div>
</td></tr>
</table>
</body>
</html>`;
  return { html, bodyHtml };
}


/** نسخة نصّية من الرسالة.
 *
 *  رسالة HTML بلا بديل نصّي علامةٌ كلاسيكية على البريد المزعج عند مرشّحات
 *  السبام، كما أنها تصل مشوّهة لمن يقرأ بالنص المجرّد. */
export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}
