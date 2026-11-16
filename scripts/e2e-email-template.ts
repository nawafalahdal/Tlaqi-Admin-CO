/** **قالبُ البريد الموحّد** (البند ٢ وق٦): الشعارُ يساراً وجهةُ الرسالة يميناً باتجاهٍ صريح، والعبارةُ «نلتقي • نفكر • نصنع»
 *  بنصّها، وعلامةُ التذييل بلون Mahogany دائماً، والبطاقةُ في وسط رسالة الاعتماد. لا يحتاج قاعدة بيانات.
 *  تشغيل: npx tsx --tsconfig tsconfig.json scripts/e2e-email-template.ts */
import { renderEmail, emailSenderLabel, TAGLINE } from "@/lib/emailBrand";
import { renderWelcomeEmail } from "@/lib/email";
import { CARD_CONTENT_ID } from "@/lib/cardInline";

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
const header = (html: string) => html.slice(html.indexOf("logo-on-temptress") - 600, html.indexOf("pattern-talent"));

try {
  // ── العبارةُ بنصّها وترتيبها (ق٦)
  chk("**العبارةُ «نلتقي • نفكر • نصنع» بنصّها**", TAGLINE === "نلتقي • نفكر • نصنع", TAGLINE);
  const plain = renderEmail({ subject: "فحص", content: { title: "عنوان", lead: "متن" }, theme: { departmentName: "التقنية", colorHex: "#3366CC" } }).html;
  chk("وفي تذييل الرسالة", plain.includes("نلتقي • نفكر • نصنع"));
  chk("ولا أثرَ للعبارة السابقة", !plain.includes("تحوّل رقمي، برؤية طموحة"));

  // ── الترويسة: الشعارُ يساراً والجهةُ يميناً — باتجاهٍ صريح
  const h = header(plain);
  chk("**جدولُ الترويسة باتجاهٍ صريح من اليسار**", /<table[^>]*dir="ltr"[^>]*style="direction:ltr"/.test(h), h.slice(0, 200));
  chk("الشعارُ أولاً وفي اليسار", h.indexOf('align="left"') > -1 && h.indexOf('align="left"') < h.indexOf("logo-on-temptress") && h.indexOf("logo-on-temptress") < h.indexOf("قسم التقنية"));
  chk("والجهةُ ثانياً وفي اليمين بنصٍّ عربي", /<td align="right"[^>]*dir="rtl"[^>]*>قسم التقنية<\/td>/.test(h));

  // ── جهةُ الرسالة لكل حالة
  chk("قسمٌ: «قسم X»", emailSenderLabel({ departmentName: "التسويق" }) === "قسم التسويق");
  chk("لجنةٌ: «لجنة X — قسم Y»", emailSenderLabel({ departmentName: "المحتوى", parentName: "التسويق" }) === "لجنة المحتوى — قسم التسويق");
  chk("ولا يتكرّر اللفظ", emailSenderLabel({ departmentName: "لجنة المحتوى", parentName: "قسم التسويق" }) === "لجنة المحتوى — قسم التسويق");
  chk("الإدارةُ العليا باسمها", emailSenderLabel({ departmentName: "الإدارة العليا", leadershipOnly: true }) === "الإدارة العليا");
  chk("وبلا جهة: «إدارة TLAQI»", emailSenderLabel(null) === "إدارة TLAQI" && emailSenderLabel({ departmentName: "  " }) === "إدارة TLAQI");
  const general = renderEmail({ subject: "فحص", content: { title: "عنوان" } }).html;
  chk("ورسالةٌ بلا قسم تقول «إدارة TLAQI» في ترويستها", header(general).includes("إدارة TLAQI"));
  const xss = renderEmail({ subject: "x", content: { title: "x" }, theme: { departmentName: "<img src=x onerror=alert(1)>" } }).html;
  chk("واسمُ الجهة يُهرَّب (لا HTML من اسم قسم)", !xss.includes("<img src=x") && xss.includes("&lt;img"));

  // ── علامةُ التذييل: Mahogany دائماً
  for (const hex of ["#3366CC", "#2F7D32", "#C2185B"]) {
    const html = renderEmail({ subject: "x", content: { title: "x" }, theme: { departmentName: "قسم", colorHex: hex } }).html;
    chk(`علامةُ التذييل Mahogany مع لون ${hex}`, html.includes("email/mark-mahogany.png") && !html.includes("/api/brand-mark/"));
  }

  // ── البطاقةُ في وسط رسالة الاعتماد
  const welcome = renderWelcomeEmail({ fullName: "ريم الاختبارية", roleLabel: "عضو", departmentName: "التقنية", withCard: true, cardInline: true, gender: "female" } as never);
  const iImg = welcome.indexOf(`cid:${CARD_CONTENT_ID}`);
  chk("**البطاقةُ في رسالة الاعتماد بمعرّف cid**", iImg > -1);
  chk("في وسطها: بعد العنوان والافتتاح وقبل التذييل", iImg > welcome.indexOf("<h1") && iImg < welcome.indexOf("mark-mahogany"));
  chk("ومتمركزةٌ بعرضٍ ثابت (Outlook)", /<table role="presentation" align="center"[^>]*><tr><td align="center"><img src="cid:tlaqi-card" width="260"/.test(welcome));
  const noCard = renderWelcomeEmail({ fullName: "ريم", roleLabel: "عضو", withCard: true, cardInline: false } as never);
  chk("وبلا نسخةٍ مضمّنة لا صورةَ مكسورة", !noCard.includes("cid:"));
} catch (e) {
  chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
} finally {
  for (const c of checks) console.log(c);
  const failedN = checks.filter((c) => c.startsWith("✗")).length;
  console.log(`\n${checks.length - failedN}/${checks.length}`);
  process.exit(failedN ? 1 : 0);
}
