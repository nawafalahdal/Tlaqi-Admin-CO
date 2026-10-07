/** هوية رسائل البريد: الترويسة والبانر والتذييل.
 *
 *  كل رسالة تخرج من المنصة تمرّ من هنا، فتتّحد هويتها ولا تُكتب مرتين.
 *  القواعد التي يفرضها هذا الملف ليست تجميلاً: عملاء البريد (Gmail،
 *  Outlook) يتجاهلون <style> و CSS الحديث، فالتنسيق كله inline وداخل
 *  جداول — وهي الطريقة الوحيدة التي تُرسم بها الرسالة كما كُتبت.
 */

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

/** خلفية بلون الهوية مرسومة كصورة لا كلون.
 *
 *  Gmail على الجوال يعكس ألوان الخلفيات في الوضع الداكن ويتجاهل إعلان
 *  color-scheme، فكانت ترويسة تَـــلاقِ الداكنة تصير وردية. والصور لا
 *  يعكسها أي عميل — ولهذا بقي الشعار نفسه سليماً بينما انقلب ما حوله.
 *  فتُرسم ألوان الهوية بصورة مربّعة صلبة تتكرّر، ويبقى اللون المكتوب
 *  خلفها لمن لا يحمّل الصور. */
function brandFill(tile: string, color: string) {
  return `background-color:${color};background-image:url('${assetUrl(tile)}');background-repeat:repeat;background-size:8px 8px`;
}

const FILL = {
  temptress: () => brandFill("/brand/bg-temptress.png", BRAND.temptress),
  card: () => brandFill("/brand/bg-card.png", "#ffffff"),
  paper: () => brandFill("/brand/bg-paper.png", BRAND.paper),
  beige: () => brandFill("/brand/bg-beige.png", BRAND.beige),
  mahogany: () => brandFill("/brand/bg-mahogany.png", BRAND.mahogany),
  alert: () => brandFill("/brand/bg-alert.png", "#8C2F1B"),
  green: () => brandFill("/brand/bg-green.png", BRAND.greenSheen),
};

/** أنواع الرسائل الأربعة.
 *
 *  الهوية واحدة في كل رسالة — الشعار والجملة والتذييل لا تتغيّر — لكن
 *  نبرتها تتغيّر. التذكرة التي تحتاج إجراءً يجب أن تُعرف من نظرة واحدة في
 *  صندوق وارد مزدحم، ورسالة الشهادة لا تُرسل بنبرة الإنذار. */
export type EmailVariant = "default" | "ticket" | "celebration" | "serious" | "security";

const VARIANT_STYLE: Record<
  EmailVariant,
  {
    rule: string;
    ruleFill: string;
    badge: string | null;
    badgeFill: string;
    badgeColor: string;
    note: string | null;
  }
> = {
  default: {
    rule: BRAND.mahogany,
    ruleFill: FILL.mahogany(),
    badge: null,
    badgeFill: FILL.mahogany(),
    badgeColor: "#ffffff",
    note: null,
  },
  ticket: {
    rule: BRAND.mahogany,
    ruleFill: FILL.mahogany(),
    badge: "تذكرة عمل · تحتاج إجراءً",
    badgeFill: FILL.mahogany(),
    badgeColor: "#ffffff",
    note: "هذه تذكرة في نظام العمل، وليست إشعاراً عابراً. لها مهلة، وإن انقضت دون ردّ تُصعَّد تلقائياً إلى المسؤول الذي يليك.",
  },
  celebration: {
    rule: BRAND.greenSheen,
    ruleFill: FILL.green(),
    badge: "خبر سار",
    badgeFill: FILL.green(),
    badgeColor: "#10321F",
    note: null,
  },
  serious: {
    rule: "#8C2F1B",
    ruleFill: FILL.alert(),
    badge: "إشعار رسمي",
    badgeFill: FILL.alert(),
    badgeColor: "#ffffff",
    note: "هذا الإشعار مُسجَّل في سجلّ الفريق ويمكن الرجوع إليه.",
  },
  security: {
    rule: BRAND.temptress,
    ruleFill: FILL.temptress(),
    badge: "رمز دخول لمرة واحدة",
    badgeFill: FILL.temptress(),
    badgeColor: BRAND.beige,
    // التحذير المضاد للتصيّد: أكثر ما يُسرق به رمز الدخول أن يتصل أحد
    // بصاحبه منتحلاً صفة الفريق ويطلبه منه
    note: "لا تشارك هذا الرمز مع أحد مهما كان. فريق تَـــلاقِ لن يطلبه منك أبداً — لا بمكالمة ولا برسالة. إن لم تكن أنت من حاول الدخول، غيّر كلمة مرورك فوراً.",
  },
};

/** يربط نوع الرسالة بتصميمها.
 *
 *  المفتاح هو الوسم الذي تمرّره كل دالة إرسال أصلاً، فلا تحتاج أي دالة
 *  أن تعرف شيئاً عن التصميم. وما لا يُذكر هنا يأخذ التصميم العام: رسالة
 *  بلا هوية مستحيلة لا مستبعدة. */
const KIND_VARIANT: Record<string, EmailVariant> = {
  // التذاكر والطلبات — عمل له مهلة
  "تذكرة جديدة": "ticket",
  "تأكيد تذكرة": "ticket",
  "تصعيد تذكرة": "ticket",
  "حل تذكرة": "ticket",
  "تذكير تذكرة": "ticket",
  "تذكير طلب": "ticket",
  "تكليف اجتماع شرح": "ticket",
  "اجتماع شرح": "ticket",

  // ما يُفرح
  "اجتياز الاختبار": "celebration",
  "الاعتماد النهائي": "celebration",
  "شهادة إتمام": "celebration",
  "إعادة فتح الاختبار": "celebration",

  // ما يُسجَّل ويُحاسَب عليه
  تنبيه: "serious",
  "إنهاء عضوية": "serious",
  "عدم اجتياز الاختبار": "serious",
  "تذكير قبل سقوط المهلة": "serious",

  // الأمن
  "رمز الدخول": "security",

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

/** حسابات التواصل. تُقرأ من البيئة لأنها تتغيّر ولا يصحّ تخمينها:
 *  رابط حساب خاطئ في بريد رسمي أسوأ من غياب الرابط. الصفّ كله لا يُرسم
 *  ما لم يُضبط منها شيء. */
/** اليوزر موحّد على المنصات الثلاث. يبقى قابلاً للضبط من البيئة لتغييره
 *  دون نشر، وأي منصة يُفرَّغ يوزرها تختفي من الصفّ من تلقاء نفسها. */
const UNIFIED_HANDLE = "tlaqisa";

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

/** يغلّف متن الرسالة بالهوية الكاملة: ترويسة بالشعار، ثم المتن، ثم بانر
 *  التواصل والجملة. */
export function wrapEmail(opts: {
  title: string;
  bodyHtml: string;
  preheader?: string;
  variant?: EmailVariant;
}) {
  const style = VARIANT_STYLE[opts.variant ?? "default"];
  // اليوزر يُكتب مرة واحدة تحت الأسماء ما دام موحّداً على كل المنصات؛
  // فإن اختلف يوماً، كُتب مع اسم منصّته حتى لا يدلّ سطرٌ واحد على خطأ
  const sameHandle =
    SOCIAL_LINKS.length > 0 && SOCIAL_LINKS.every((s) => s.handle === SOCIAL_LINKS[0].handle);

  const social =
    SOCIAL_LINKS.length === 0
      ? ""
      : `<tr>
          <td align="center" dir="ltr" class="tq-dark" bgcolor="${BRAND.temptress}" style="${FILL.temptress()};padding:0 20px 16px;white-space:nowrap">
            <span style="font-family:Tahoma,Arial,sans-serif;font-size:12px;color:${BRAND.beige}">
              ${SOCIAL_LINKS.map(
                (s) =>
                  `<a href="${s.url}${esc(s.handle)}" style="color:${BRAND.beige};text-decoration:none;font-weight:bold">${esc(s.label)}${sameHandle ? "" : ` @${esc(s.handle)}`}</a>`
              ).join(
                `<span style="color:${BRAND.mahogany};padding:0 8px">&bull;</span>`
              )}
            </span>
            ${
              sameHandle
                ? `<div style="font-family:Tahoma,Arial,sans-serif;font-size:11px;color:rgba(238,246,223,0.55);margin-top:5px">@${esc(SOCIAL_LINKS[0].handle)}</div>`
                : ""
            }
          </td>
        </tr>`;

  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- إعلان دعم الوضع الداكن.
     بدونه يقلب Gmail ألوان الرسالة كلها بنفسه: الترويسة الداكنة تصير
     وردية والبيج يصير زيتونياً — وهو ما كان يحدث فعلاً. هذا الإعلان
     يقول للعميل إن الرسالة تتدبّر ألوانها، فيكفّ عن فرض انقلابه. -->
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  /* Outlook.com يضع هاتين السمتين على عناصره عند الوضع الداكن، فنثبّت
     ألواننا تحتهما صراحةً بدل أن يُعاد حسابها */
  [data-ogsc] .tq-dark, [data-ogsb] .tq-dark { background:${BRAND.temptress} !important; }
  [data-ogsc] .tq-on-dark { color:${BRAND.beige} !important; }
  [data-ogsc] .tq-card, [data-ogsb] .tq-card { background:#ffffff !important; }
  [data-ogsc] .tq-ink { color:${BRAND.ink} !important; }
</style>
<title>${esc(opts.title)}</title>
</head>
<body bgcolor="${BRAND.paper}" style="margin:0;padding:0;${FILL.paper()};">
<!-- السطر الذي يسبق فتح الرسالة في صندوق الوارد: يُخفى داخلها -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader ?? opts.title)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.paper}" style="${FILL.paper()};padding:24px 12px">
<tr><td align="center">

  <table role="presentation" class="tq-card" bgcolor="#ffffff" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;${FILL.card()};border-radius:18px;overflow:hidden;border:1px solid rgba(0,0,0,0.06)">

    <!-- الترويسة: الشعار -->
    <tr>
      <td align="center" class="tq-dark" bgcolor="${BRAND.temptress}" style="${FILL.temptress()};padding:22px 24px 18px">
        <!-- الشعار الكامل بخلفية شفافة: كُتب اسمه بالبيج، فيظهر على
             الداكن وحده. الأبعاد مثبّتة في الوسم لأن عملاء البريد
             يرسمون قبل تحميل الصورة، فبدونها يقفز التخطيط. -->
        <img src="${assetUrl("/brand/lockup-on-dark.png")}" width="178" height="52"
             alt="تَـــلاقِ — TLAQI"
             style="display:block;border:0;margin:0 auto 9px;max-width:178px;height:auto">
        <div class="tq-on-dark" style="font-family:Tahoma,Arial,sans-serif;font-size:13px;color:rgba(238,246,223,0.72);letter-spacing:0.5px">${esc(TAGLINE)}</div>
      </td>
    </tr>

    <!-- شريط لوني فاصل: لونه يقول نوع الرسالة قبل قراءة حرف منها -->
    <tr><td style="height:5px;${style.ruleFill};font-size:0;line-height:0">&nbsp;</td></tr>

    ${
      style.badge
        ? `<tr>
      <td align="center" bgcolor="#ffffff" style="${FILL.card()};padding:18px 24px 0">
        <span style="display:inline-block;${style.badgeFill};color:${style.badgeColor};font-family:Tahoma,Arial,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.5px;padding:8px 18px;border-radius:999px">${esc(style.badge)}</span>
      </td>
    </tr>`
        : ""
    }

    <!-- المتن -->
    <tr>
      <td class="tq-ink" bgcolor="#ffffff" style="${FILL.card()};padding:${style.badge ? "18px" : "28px"} 26px 26px;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:${BRAND.ink}" dir="rtl">
        ${
          opts.variant === "ticket"
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                 <td style="border-right:3px dashed ${BRAND.mahogany};padding-right:16px">${opts.bodyHtml}</td>
               </tr></table>`
            : opts.bodyHtml
        }
        ${
          style.note
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px">
                 <tr><td bgcolor="${BRAND.paper}" style="${FILL.paper()};border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.8;color:#5a5560">${esc(style.note)}</td></tr>
               </table>`
            : ""
        }
      </td>
    </tr>

    <!-- البانر: الجملة وحسابات التواصل -->
    <tr>
      <td align="center" class="tq-dark" bgcolor="${BRAND.temptress}" style="${FILL.temptress()};padding:18px 24px 12px">
        <div class="tq-on-dark" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;color:${BRAND.beige};letter-spacing:1px">${esc(TAGLINE)}</div>
      </td>
    </tr>
    ${social}
    <tr>
      <td align="center" class="tq-dark" bgcolor="${BRAND.temptress}" style="${FILL.temptress()};padding:0 24px 22px">
        <a href="${appBaseUrl()}" style="font-family:Tahoma,Arial,sans-serif;font-size:12px;color:rgba(238,246,223,0.75);text-decoration:none">${esc(appBaseUrl().replace(/^https?:\/\//, ""))}</a>
      </td>
    </tr>
  </table>

  <div style="max-width:600px;margin:14px auto 0;font-family:Tahoma,Arial,sans-serif;font-size:11px;line-height:1.8;color:rgba(0,0,0,0.38);text-align:center">
    هذه رسالة آلية من منصة تَـــلاقِ الداخلية، أُرسلت إليك لأن لك حساباً فيها.<br>
    إن وصلتك بالخطأ فتجاهلها ولا تشارك محتواها.
  </div>

</td></tr>
</table>
</body>
</html>`;
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
