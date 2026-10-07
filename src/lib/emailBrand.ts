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

/** الجملة التي تُذيَّل بها كل رسالة. تُضبط من البيئة ليُغيّرها صاحب
 *  المنصة دون نشر جديد. */
export const TAGLINE = process.env.BRAND_TAGLINE || "نلتقي… فنصنع";

/** حسابات التواصل. تُقرأ من البيئة لأنها تتغيّر ولا يصحّ تخمينها:
 *  رابط حساب خاطئ في بريد رسمي أسوأ من غياب الرابط. الصفّ كله لا يُرسم
 *  ما لم يُضبط منها شيء. */
export const SOCIAL_LINKS: { label: string; handle: string; url: string }[] = [
  { label: "X", handle: process.env.SOCIAL_X || "", url: "https://x.com/" },
  { label: "Instagram", handle: process.env.SOCIAL_INSTAGRAM || "", url: "https://instagram.com/" },
  { label: "LinkedIn", handle: process.env.SOCIAL_LINKEDIN || "", url: "https://linkedin.com/company/" },
  { label: "TikTok", handle: process.env.SOCIAL_TIKTOK || "", url: "https://tiktok.com/@" },
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
export function wrapEmail(opts: { title: string; bodyHtml: string; preheader?: string }) {
  const social =
    SOCIAL_LINKS.length === 0
      ? ""
      : `<tr>
          <td align="center" style="padding:0 24px 18px">
            ${SOCIAL_LINKS.map(
              (s) =>
                `<a href="${s.url}${esc(s.handle)}" style="display:inline-block;margin:0 6px;padding:7px 14px;border:1px solid rgba(238,246,223,0.35);border-radius:999px;color:${BRAND.beige};font-size:12px;text-decoration:none;font-family:Tahoma,Arial,sans-serif">${esc(s.label)} · @${esc(s.handle)}</a>`
            ).join("")}
          </td>
        </tr>`;

  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.paper};">
<!-- السطر الذي يسبق فتح الرسالة في صندوق الوارد: يُخفى داخلها -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader ?? opts.title)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.paper};padding:24px 12px">
<tr><td align="center">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid rgba(0,0,0,0.06)">

    <!-- الترويسة: الشعار -->
    <tr>
      <td align="center" style="background:${BRAND.temptress};padding:26px 24px">
        <img src="${assetUrl("/brand/symbol.png")}" width="56" height="56" alt="تَـــلاقِ"
             style="display:block;border:0;border-radius:50%;margin:0 auto 10px">
        <div style="font-family:Tahoma,Arial,sans-serif;font-size:21px;font-weight:bold;color:${BRAND.beige};letter-spacing:1px">تَـــلاقِ</div>
        <div style="font-family:Tahoma,Arial,sans-serif;font-size:12px;color:rgba(238,246,223,0.65);margin-top:4px">${esc(TAGLINE)}</div>
      </td>
    </tr>

    <!-- شريط لوني فاصل -->
    <tr><td style="height:4px;background:${BRAND.mahogany};font-size:0;line-height:0">&nbsp;</td></tr>

    <!-- المتن -->
    <tr>
      <td style="padding:28px 26px;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:${BRAND.ink}" dir="rtl">
        ${opts.bodyHtml}
      </td>
    </tr>

    <!-- البانر: الجملة وحسابات التواصل -->
    <tr>
      <td align="center" style="background:${BRAND.temptress};padding:22px 24px 8px">
        <div style="font-family:Tahoma,Arial,sans-serif;font-size:17px;font-weight:bold;color:${BRAND.beige}">${esc(TAGLINE)}</div>
        <div style="font-family:Tahoma,Arial,sans-serif;font-size:12px;color:rgba(238,246,223,0.6);margin:6px 0 16px">منصة تَـــلاقِ الداخلية</div>
      </td>
    </tr>
    ${social}
    <tr>
      <td align="center" style="background:${BRAND.temptress};padding:0 24px 22px">
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
