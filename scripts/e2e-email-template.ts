/** **قالبُ البريد الموحّد** (البند ٢ وق٦، وطلب المؤسس نوفمبر 2026 «لا إطار أبيض»): الشعارُ يساراً وجهةُ الرسالة يميناً
 *  باتجاهٍ صريح، والعبارةُ «نلتقي • نفكر • نصنع» بنصّها، وعلامةُ التذييل Mahogany دائماً، والبطاقةُ في رسالة الاعتماد —
 *  **والهويةُ ممتدةٌ على الرسالة كلها**: أشرطةٌ بعرض الشاشة بلا صفحةٍ خلفها ولا بطاقةٍ عائمة، وصورُ الهوية مضمّنةٌ (`cid:`)
 *  لا روابطَ خارجية، وخطُّ النظام (Apple أولاً) بلا خطٍّ يُحمَّل من الخارج. لا يحتاج قاعدة بيانات.
 *  تشغيل: npx tsx --tsconfig tsconfig.json scripts/e2e-email-template.ts */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { renderEmail, composeEmail, inlineForPreview, emailSenderLabel, TAGLINE } from "@/lib/emailBrand";
import { renderWelcomeEmail } from "@/lib/email";
import { CARD_CONTENT_ID } from "@/lib/cardInline";
import { EMAIL_BRAND_ASSETS } from "@/lib/brand2026/emailAssets.generated";
import { EMAIL_FONT_STACK, HEX } from "@/lib/brand2026/tokens";

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
// تغييرُ توقّعٍ مقصود: الشعارُ والنمطُ صارا `cid:` بدل روابط `/brand/2026/email/*.png` — فالترويسةُ تُحدّ بمعرّفيهما
const header = (html: string) => html.slice(html.indexOf("cid:tlaqi-logo") - 600, html.indexOf("cid:tlaqi-pattern"));

try {
  // ── العبارةُ بنصّها وترتيبها (ق٦)
  chk("**العبارةُ «نلتقي • نفكر • نصنع» بنصّها**", TAGLINE === "نلتقي • نفكر • نصنع", TAGLINE);
  const plain = renderEmail({ subject: "فحص", content: { title: "عنوان", lead: "متن" }, theme: { departmentName: "التقنية", colorHex: "#3366CC" } }).html;
  chk("وفي تذييل الرسالة", plain.includes("نلتقي • نفكر • نصنع"));
  chk("ولا أثرَ للعبارة السابقة", !plain.includes("تحوّل رقمي، برؤية طموحة"));

  // ── الترويسة: الشعارُ يساراً والجهةُ يميناً — باتجاهٍ صريح
  const h = header(plain);
  chk("**جدولُ الترويسة باتجاهٍ صريح من اليسار**", /<table[^>]*dir="ltr"[^>]*style="direction:ltr"/.test(h), h.slice(0, 200));
  chk("الشعارُ أولاً وفي اليسار", h.indexOf('align="left"') > -1 && h.indexOf('align="left"') < h.indexOf("cid:tlaqi-logo") && h.indexOf("cid:tlaqi-logo") < h.indexOf("قسم التقنية"));
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

  // ── علامةُ التذييل: Mahogany دائماً (تغييرُ توقّعٍ مقصود: مضمّنةٌ `cid:tlaqi-mark` من `mark-mahogany.png` لا رابطٌ خارجي)
  for (const hex of ["#3366CC", "#2F7D32", "#C2185B"]) {
    const html = renderEmail({ subject: "x", content: { title: "x" }, theme: { departmentName: "قسم", colorHex: hex } }).html;
    chk(`علامةُ التذييل Mahogany مع لون ${hex}`, html.includes("cid:tlaqi-mark") && !html.includes("/api/brand-mark/"));
  }
  chk("وعلامةُ التذييل المضمّنة هي ملفُّ Mahogany نفسُه", EMAIL_BRAND_ASSETS.mark.source.endsWith("mark-mahogany.png"));

  // ═══ السببُ الجذري (١): الإطارُ الأبيض كان في القالب — صفحةٌ خلف بطاقةٍ عائمة ═══
  chk("**لا خلفيةَ صفحةٍ خارجية** (`#FAF8F4` ليست من ألوان الهوية)", !/FAF8F4/i.test(plain));
  chk("**ولا متنَ أبيض** — المتنُ Beige الرسمي", !/#FFFFFF/i.test(plain) && plain.includes(`bgcolor="${HEX.beige}"`));
  chk("ولا بطاقةَ عائمة بحدٍّ وزوايا (`b26-card`)", !plain.includes("b26-card") && !/border-radius:20px/.test(plain));
  chk("**والجسمُ والغلافُ بلون الهوية** (ما بعد التذييل امتدادٌ له لا بياض)", plain.includes(`<body style="margin:0;padding:0;width:100%;background-color:${HEX.temptress}`) && /<table role="presentation" width="100%"[^>]*bgcolor="#341D2B"/.test(plain));
  chk("ولا حشوَ خارجي حول الأشرطة", !/padding:24px 0/.test(plain) && !/padding:0 10px/.test(plain));
  const bands = [...plain.matchAll(/<tr><td align="center" bgcolor="([^"]+)"[^>]*padding:0">/g)].map((m) => m[1]);
  chk(`**أربعةُ أشرطةٍ بعرض الشاشة:** ترويسةٌ داكنة، نمطٌ وBeige، متنٌ Beige، تذييلٌ داكن (${bands.join(" ")})`, bands.join(",") === [HEX.temptress, HEX.beige, HEX.beige, HEX.temptress].join(","));
  chk("والمحتوى في عمودٍ أقصاه 600 وجدولٌ ثابتٌ لـOutlook", (plain.match(/max-width:600px;margin:0 auto/g) ?? []).length === 4 && (plain.match(/<!--\[if mso\]><table role="presentation" width="600"/g) ?? []).length === 4);
  chk("وسطرُ «مُرسَلة من» داخل التذييل لا تحته", plain.indexOf("مُرسَلة من إدارة تلاق") > plain.indexOf("cid:tlaqi-mark") && plain.indexOf("مُرسَلة من إدارة تلاق") < plain.lastIndexOf("</table>"));

  // ═══ السببُ الجذري (٢): مربّعُ الشعار الفارغ — صورُ الهوية كانت روابطَ خارجية ═══
  chk("**لا صورةَ خارجيةً في القالب**", ![...plain.matchAll(/<img[^>]+src="([^"]+)"/g)].some((m) => /^https?:/.test(m[1])));
  const composed = composeEmail({ subject: "فحص", content: { title: "عنوان", lead: "متن" }, kind: "عام" });
  const cids = [...composed.html.matchAll(/src="cid:([^"]+)"/g)].map((m) => m[1]);
  chk("**وكلُّ `cid:` في الرسالة له مرفقٌ مضمّن** (الشعار، النمط، العلامة)", cids.length === 3 && cids.every((id) => composed.attachments.some((a) => a.contentId === id)), JSON.stringify(cids));
  for (const a of Object.values(EMAIL_BRAND_ASSETS)) {
    const file = readFileSync(a.source);
    chk(`والمضمَّنُ يطابق الملفَّ الأصلي بايتاً ببايت (${a.source.split("/").pop()})`, createHash("sha256").update(file).digest("hex") === a.sha256 && Buffer.from(a.base64, "base64").equals(file));
  }
  const preview = inlineForPreview(composed.html, composed.attachments);
  chk("وملفُّ المعاينة لا يطلب شيئاً من الشبكة", !preview.includes("cid:") && (preview.match(/src="data:image\/png;base64,/g) ?? []).length === 3);
  chk("والنصُّ البديل موجود", composed.text.includes("عنوان") && composed.text.includes("متن"));
  const withOwn = composeEmail({ subject: "x", content: { title: "x" }, kind: "عام", attachments: [{ filename: "c.png", content: Buffer.from("x"), contentId: CARD_CONTENT_ID }] });
  chk("ومرفقاتُ الرسالة نفسها تبقى أولاً ولا تتكرّر صورُ الهوية", withOwn.attachments[0].contentId === CARD_CONTENT_ID && withOwn.attachments.length === 4);

  // ═══ الخط: خطُّ النظام — Apple أولاً — بلا خطٍّ خارجي ═══
  chk("**خطُّ Apple أولاً ببدائل لكل جهاز**", EMAIL_FONT_STACK.startsWith("-apple-system,BlinkMacSystemFont,'SF Arabic'") && EMAIL_FONT_STACK.endsWith("Tahoma,Arial,sans-serif"));
  // (الجزءُ الخاصُّ بـOutlook يُستثنى هنا — فحصُه أدناه)
  const fams = new Set([...plain.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "").matchAll(/font-family:([^;"]+)/g)].map((m) => m[1]));
  chk("وخطٌّ واحدٌ في الرسالة كلها (لا Courier ولا غيره)", fams.size === 1 && fams.has(EMAIL_FONT_STACK), [...fams].join(" | "));
  chk("ولا خطَّ يُحمَّل من الخارج", !plain.includes("@font-face") && !plain.includes("the-year-of-the-camel"));
  chk("وOutlook على ويندوز يُفرض عليه Tahoma (وإلا رسم Times New Roman)", /<!--\[if mso\]><style>[^<]*font-family:Tahoma,Arial,sans-serif !important/.test(plain));
  const code = renderEmail({ subject: "x", content: { title: "x", code: { value: "482913" } } }).html;
  chk("ورمزُ الدخول بالخط نفسه بأرقامٍ متساوية العرض", !code.includes("Courier") && code.includes("tabular-nums"));

  // ── البطاقةُ في رسالة الاعتماد — بعد النصّ الذي يقدّمها
  const welcome = renderWelcomeEmail({ fullName: "ريم الاختبارية", roleLabel: "عضو", departmentName: "التقنية", withCard: true, cardInline: true, gender: "female" } as never);
  const iImg = welcome.indexOf(`cid:${CARD_CONTENT_ID}`);
  chk("**البطاقةُ في رسالة الاعتماد بمعرّف cid**", iImg > -1);
  // تغييرُ توقّعٍ مقصود: البطاقةُ بعد الفقرة التي تقدّمها (كانت قبلها فجاءت «وهذه بطاقتك» بعدها) وقبل التذييل
  chk("**بعد الفقرة التي تقدّمها** وقبل التذييل", iImg > welcome.indexOf("أدناه") && iImg < welcome.indexOf("cid:tlaqi-mark"));
  chk("ومتمركزةٌ بعرضٍ ثابت (Outlook)", /<table role="presentation" align="center"[^>]*><tr><td align="center"><img src="cid:tlaqi-card" width="260"/.test(welcome));
  chk("وبحدٍّ رفيعٍ Temptress يحفظ حافتَها على المتن الـBeige", /src="cid:tlaqi-card"[^>]*border:1px solid #341D2B/.test(welcome));
  chk("**ونصُّها فقرةٌ واحدة** (لا جملٌ متفرّقة)", (welcome.match(/<p style=/g) ?? []).length === 1, String((welcome.match(/<p style=/g) ?? []).length));
  chk("ومعلوماتُها كلُّها باقية: الجهة والمهمة والحفظ والطباعة", ["TLAQI في التقنية", "<b>عضو</b>", "جزءٌ من فريقنا", "للحفظ والطباعة", "ونتطلّع إلى ما سنصنعه معاً"].every((t) => welcome.includes(t)));
  chk("وبصيغة المؤنث", welcome.includes("انضمامكِ") && welcome.includes("أنتِ جزءٌ") && welcome.includes("تجدين بطاقتَكِ"));
  const noCard = renderWelcomeEmail({ fullName: "ريم", roleLabel: "عضو", withCard: true, cardInline: false } as never);
  chk("وبلا نسخةٍ مضمّنة لا صورةَ مكسورة", !noCard.includes("cid:tlaqi-card") && noCard.includes("مرفقةٌ بهذه الرسالة"));
  const resend = renderWelcomeEmail({ fullName: "ريم", roleLabel: "عضو", withCard: true, cardInline: true, occasion: "resend" } as never);
  chk("وإعادةُ الإرسال لا تُعلن خبراً قديماً كأنه جديد", resend.includes("نعيد إليك رسالةَ اعتماد") && !resend.includes("يسعدنا اعتمادُ"));
} catch (e) {
  chk("لم يقع استثناء", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") ?? e.message : String(e));
} finally {
  for (const c of checks) console.log(c);
  const failedN = checks.filter((c) => c.startsWith("✗")).length;
  console.log(`\n${checks.length - failedN}/${checks.length}`);
  process.exit(failedN ? 1 : 0);
}
