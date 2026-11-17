/** **قالبُ البريد الموحّد** (البند ٢ وق٦، وطلب المؤسس 17 نوفمبر 2026 «لا إطار أبيض أبداً، ومتوافقٌ مع الداكن والفاتح»):
 *  **الترويسةُ صورةٌ** بجهة الرسالة، **والتذييلُ صورةٌ** بالعلامة و«نلتقي • نفكر • نصنع» والتدرّج، **والمتنُ بلا خلفيةٍ أصلاً** —
 *  نصٌّ على خلفية تطبيق البريد، بألوانٍ تنقلب في الوضع الداكن (Apple Mail وOutlook)، ولا صندوقَ بتعبئةٍ يقلبه Gmail.
 *  وصورُ الهوية مضمّنةٌ (`cid:`) لا روابطَ خارجية، وخطُّ النظام (Apple أولاً) في النص. لا يحتاج قاعدة بيانات.
 *  تشغيل: npx tsx --tsconfig tsconfig.json scripts/e2e-email-template.ts */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { renderEmail, composeEmail, inlineForPreview, emailSenderLabel, TAGLINE } from "@/lib/emailBrand";
import { renderWelcomeEmail } from "@/lib/email";
import { CARD_CONTENT_ID } from "@/lib/cardInline";
import { EMAIL_BRAND_ASSETS } from "@/lib/brand2026/emailAssets.generated";
import { EMAIL_FONT_STACK, HEX } from "@/lib/brand2026/tokens";
import { composeEmailWithHeader, emailHeaderAttachment } from "@/lib/emailHeader";

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${!ok && extra ? " — " + extra : ""}`);
// تغييرُ توقّعٍ مقصود (17 نوفمبر 2026): الترويسةُ صورةٌ — فتُحدّ من أول صورةٍ في الجسم إلى بداية المتن
const header = (html: string) => html.slice(html.indexOf("<body"), html.indexOf('padding:28px 6px 6px'));
const sharpOf = async () => (await import("sharp")).default;

(async () => {
try {
  // ── العبارةُ بنصّها وترتيبها (ق٦)
  chk("**العبارةُ «نلتقي • نفكر • نصنع» بنصّها**", TAGLINE === "نلتقي • نفكر • نصنع", TAGLINE);
  const plain = renderEmail({ subject: "فحص", content: { title: "عنوان", lead: "متن" }, theme: { departmentName: "التقنية", colorHex: "#3366CC" } }).html;
  chk("وفي تذييل الرسالة", plain.includes("نلتقي • نفكر • نصنع"));
  chk("ولا أثرَ للعبارة السابقة", !plain.includes("تحوّل رقمي، برؤية طموحة"));

  // ── الترويسة: صورةٌ في أول الرسالة — بجهتها مرسومةً، أو القاعدةُ والجهةُ نصٌّ تحتها
  const h = header(plain);
  chk("**الترويسةُ صورةٌ في أول الرسالة**", /^<body[\s\S]*?<img src="cid:tlaqi-header-base"/.test(h) && (h.match(/<img /g) ?? []).length === 1, h.slice(0, 160));
  chk("وبلا ترويسةٍ مرسومة: الجهةُ نصٌّ تحت الصورة (لا تضيع)", /<span class="t-muted"[^>]*>قسم التقنية<\/span>/.test(h));
  const hdr = await emailHeaderAttachment("قسم التقنية");
  chk("**والترويسةُ المرسومة تحمل الجهةَ بخطّ الهوية**", !!hdr && hdr.contentId === "tlaqi-header" && hdr.content.length > 1000);
  if (hdr) {
    // حبرُ الجهة في يمين اللوح: بكسلاتٌ فاتحة (Beige) حيث القاعدةُ Temptress خالصة
    const sharp = await sharpOf();
    const light = async (buf: Buffer) => {
      const { data, info } = await sharp(buf).extract({ left: 700, top: 50, width: 440, height: 100 }).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let k = 0; k < data.length; k += info.channels) if (data[k] > 150 && data[k + 1] > 150) n++;
      return n;
    };
    const base = Buffer.from(EMAIL_BRAND_ASSETS.headerBase.base64, "base64");
    chk("ورُسمت فعلاً (حبرٌ فاتح حيث القاعدةُ خالية)", (await light(base)) === 0 && (await light(hdr.content)) > 500);
  }
  const sent = await composeEmailWithHeader({ subject: "فحص", content: { title: "عنوان", lead: "متن" }, kind: "عام", theme: { departmentName: "التقنية", colorHex: "#3366CC" } });
  chk("**وما يُرسَل يستعمل المرسومة** — مرفقةٌ، ونصُّها البديل بالجهة، ولا سطرَ جهةٍ مكرّر", sent.html.includes('src="cid:tlaqi-header"') && sent.attachments.some((a) => a.contentId === "tlaqi-header") && sent.html.includes('alt="TLAQI — قسم التقنية"') && !sent.html.includes('class="t-muted" style="font-family:' + EMAIL_FONT_STACK + ';font-size:13px;font-weight:bold'));
  chk("وجهتان مختلفتان ترويستان مختلفتان (لا تخزينَ خاطئ)", !(await emailHeaderAttachment("الإدارة العليا"))!.content.equals(hdr!.content));

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

  // ── التذييل: صورةٌ في آخر الرسالة — العلامةُ Mahogany مع أيّ لون قسم (لا رابطَ لعلامةٍ ملوّنة)
  for (const hex of ["#3366CC", "#2F7D32", "#C2185B"]) {
    const html = renderEmail({ subject: "x", content: { title: "x" }, theme: { departmentName: "قسم", colorHex: hex } }).html;
    chk(`صورةُ التذييل نفسُها مع لون ${hex}`, html.includes("cid:tlaqi-footer") && !html.includes("/api/brand-mark/"));
  }
  chk("والتذييلُ مولَّدٌ من علامة Mahogany نفسِها", EMAIL_BRAND_ASSETS.mark.source.endsWith("mark-mahogany.png") && EMAIL_BRAND_ASSETS.footer.source === "generated:footer");

  // ═══ السببُ الجذري للإطار الأبيض: خلفياتٌ ملوّنة يحيطها Gmail بخلفيته — فلا خلفيةَ في الرسالة أصلاً ═══
  const noCmt = (x: string) => x.replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  const cta = renderEmail({ subject: "x", content: { title: "x", lead: "y", code: { value: "482913" }, facts: [["أ", "ب"]], cta: { label: "زر", url: "https://example.test" }, secondary: { label: "ثانٍ", url: "https://example.test" } } }).html;
  chk("**لا لونَ خلفيةٍ في الرسالة كلها** (لا bgcolor ولا background إلا الزرّ)", !/bgcolor=/i.test(noCmt(cta)) && (noCmt(cta).match(/background(-color)?:/g) ?? []).length === 1 && /class="t-btn" style="[^"]*background-color:/.test(cta));
  chk("**والجسمُ بلا خلفية** — خلفيةُ تطبيق البريد نفسُها", /<body style="margin:0;padding:0;width:100%;font-family:[^"]*">/.test(plain) && !/<body[^>]*background/.test(plain));
  chk("ولا خلفيةَ صفحةٍ ولا بطاقةَ عائمة (`#FAF8F4`، `b26-card`)", !/FAF8F4/i.test(plain) && !plain.includes("b26-card"));
  chk("**الوضعان معلَنان** (`color-scheme: light dark`)", plain.includes('<meta name="color-scheme" content="light dark">') && plain.includes(":root{color-scheme:light dark"));
  const darkCss = plain.slice(plain.indexOf("@media (prefers-color-scheme:dark)"));
  chk("**وألوانُ الداكن لكل نصّ** (Apple Mail): النصُّ Beige، والعنوانُ والروابطُ برتقاليٌّ فاتح", darkCss.includes(`.t-text{color:${HEX.beige}!important}`) && darkCss.includes(".t-title{color:#F08A52!important}") && darkCss.includes(".t-link{color:#F4A274!important}") && darkCss.includes(".t-muted{"));
  chk("وOutlook.com بمحدِّداته (`data-ogsc`)", plain.includes("[data-ogsc] .t-text") && plain.includes("[data-ogsb] .t-btn"));
  const classed = ["t-title", "t-text", "t-muted"].every((c) => cta.includes(`class="${c}`)) && cta.includes('class="t-code"') && cta.includes('class="t-btn2"');
  chk("وكلُّ نصٍّ في المتن له صنفُه الذي يُقلب", classed);
  chk("**ورمزُ الدخول صندوقٌ بحدٍّ لا بتعبئة** (لا يقلبه Gmail مربّعاً)", /<td class="t-code" align="center" style="border:2px solid #C34900;border-radius:16px;padding:18px 12px">/.test(cta));
  chk("والمحتوى في عمودٍ أقصاه 600 وجدولٌ ثابتٌ لـOutlook", (plain.match(/max-width:600px;margin:0 auto/g) ?? []).length === 1 && (plain.match(/<!--\[if mso\]><table role="presentation" width="600"/g) ?? []).length === 1);

  // ═══ صورُ الهوية مضمّنةٌ لا روابطُ خارجية ═══
  chk("**لا صورةَ خارجيةً في القالب**", ![...plain.matchAll(/<img[^>]+src="([^"]+)"/g)].some((m) => /^https?:/.test(m[1])));
  const composed = composeEmail({ subject: "فحص", content: { title: "عنوان", lead: "متن" }, kind: "عام" });
  const cids = [...composed.html.matchAll(/src="cid:([^"]+)"/g)].map((m) => m[1]);
  chk("**وكلُّ `cid:` في الرسالة له مرفقٌ مضمّن** (الترويسة والتذييل)", cids.join(",") === "tlaqi-header-base,tlaqi-footer" && cids.every((id) => composed.attachments.some((a) => a.contentId === id)), JSON.stringify(cids));
  for (const a of Object.values(EMAIL_BRAND_ASSETS).filter((x) => !x.source.startsWith("generated:"))) {
    const file = readFileSync(a.source);
    chk(`والمضمَّنُ يطابق الملفَّ الأصلي بايتاً ببايت (${a.source.split("/").pop()})`, createHash("sha256").update(file).digest("hex") === a.sha256 && Buffer.from(a.base64, "base64").equals(file));
  }
  const preview = inlineForPreview(composed.html, composed.attachments);
  chk("وملفُّ المعاينة لا يطلب شيئاً من الشبكة", !preview.includes("cid:") && (preview.match(/src="data:image\/png;base64,/g) ?? []).length === 2);
  chk("والنصُّ البديل موجود", composed.text.includes("عنوان") && composed.text.includes("متن"));
  const withOwn = composeEmail({ subject: "x", content: { title: "x" }, kind: "عام", attachments: [{ filename: "c.png", content: Buffer.from("x"), contentId: CARD_CONTENT_ID }] });
  chk("ومرفقاتُ الرسالة نفسها تبقى أولاً ولا تتكرّر صورُ الهوية", withOwn.attachments[0].contentId === CARD_CONTENT_ID && withOwn.attachments.length === 3);

  // ═══ قرارات المؤسس: التدرّجُ السفلي، لا شارة، X وLinkedIn وحدهما ═══
  // (`white-space` خاصيّةُ التفاف نصّ لا لون — تُستثنى)
  const WHITE = /#fff(fff)?\b|\bwhite\b(?!-space)/i;
  chk("**لا أبيضَ مكتوبٌ في القالب** (لا #FFF ولا white)", !WHITE.test(noCmt(cta)) && !WHITE.test(plain.slice(plain.indexOf("<style>"), plain.indexOf("</style>"))));
  const fpx = await (async () => {
    const sharp = await sharpOf();
    const { data, info } = await sharp(Buffer.from(EMAIL_BRAND_ASSETS.footer.base64, "base64")).raw().toBuffer({ resolveWithObject: true });
    const at = (y: number) => "#" + [0, 1, 2].map((c) => data[(y * info.width + Math.floor(info.width / 2)) * info.channels + c].toString(16).padStart(2, "0")).join("").toUpperCase();
    const alphaCorner = data[3];
    return { top: at(2), bottom: at(info.height - 1), alphaCorner };
  })();
  chk(`**التدرّجُ السفلي داخل التذييل من Temptress إلى Mahogany** (${fpx.top} ← ${fpx.bottom})`, fpx.top === HEX.temptress.toUpperCase() && fpx.bottom === HEX.mahogany.toUpperCase());
  chk("**وزوايا الإطارين شفّافة** (تجلس على الأبيض والداكن بلا حافة)", fpx.alphaCorner === 0);
  chk("والتذييلُ آخرُ ما في الرسالة، بعد «مُرسَلة من» وبعرض العمود", plain.lastIndexOf("cid:tlaqi-footer") > plain.lastIndexOf("مُرسَلة من إدارة تلاق") && /src="cid:tlaqi-footer"[^>]*width:100%;height:auto/.test(plain) && plain.indexOf("<img", plain.lastIndexOf("cid:tlaqi-footer")) === -1);
  chk("**ولا شارةَ فوق العنوان** ولا سطرَ إنجليزي", !/border-radius:999px/.test(plain) && !composeEmail({ subject: "x", content: { title: "x", badge: "شارة", tone: "security" }, kind: "عام" }).html.includes("شارة") && !plain.includes("CERTIFICATE"));
  const footerHtml = plain.slice(plain.indexOf('class="t-rule" style="border-top'));
  const fl = [...footerHtml.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]}=${m[1]}`);
  chk(`**التذييل: X وLinkedIn وحدهما، نصّاً قابلاً للنقر** (${fl.join(" ، ")})`, fl.length === 2 && fl[0] === "X=https://x.com/tlaqisa" && fl[1] === "LinkedIn=https://linkedin.com/company/tlaqisa", fl.join(" | "));
  chk("ولا رابطَ للموقع ولا Instagram في التذييل", !footerHtml.includes("tlaqiteam.site") && !footerHtml.includes("instagram"));
  chk("والنصُّ البديلُ للتذييل يحمل العبارةَ والحساب", plain.includes('alt="TLAQI — نلتقي • نفكر • نصنع — @tlaqisa"'));

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
  chk("**بعد الفقرة التي تقدّمها** وقبل التذييل", iImg > welcome.indexOf("أدناه") && iImg < welcome.indexOf("cid:tlaqi-footer"));
  // تغييرُ توقّعٍ مقصود (Gmail على iPhone): كانت بعرضٍ ثابت 260px داخل جدولٍ متمركز — فصارت 100% من إطارٍ سقفُه عرضُها،
  // تملؤه على الشاشة العريضة وتنكمش على الضيقة. وOutlook يأخذ سمةَ العرض (260) كما كان
  chk("**ومتمركزةٌ بسقف عرضها، مرنةٌ على الشاشة الضيقة**", /<div class="t-frame" style="max-width:260px;margin:0 auto;[^"]*"><img src="cid:tlaqi-card" width="260"[^>]*style="[^"]*width:100%;height:auto/.test(welcome));
  chk("وبحدٍّ رفيعٍ يحفظ حافتَها، يُقلب في الداكن (`t-frame`)", /<div class="t-frame" style="max-width:260px;[^"]*border:1px solid rgba\(52,29,43,0\.28\)[^"]*"><img src="cid:tlaqi-card"/.test(welcome));
  chk("**ولا صورةَ في الرسالة بعرضٍ ثابتٍ أوسعَ من شاشة هاتف**", !/<img[^>]*style="[^"]*(?<!max-)width:(2[0-9]{2}|[3-9][0-9]{2})px/.test(welcome));
  chk("**ونصُّها فقرةٌ واحدة** (لا جملٌ متفرّقة)", (welcome.match(/<p class="t-text" style=/g) ?? []).length === 1, String((welcome.match(/<p class="t-text" style=/g) ?? []).length));
  chk("ومعلوماتُها كلُّها باقية: الجهة والمهمة والحفظ والطباعة", ["TLAQI في التقنية", "<b>عضو</b>", "جزءٌ من فريقنا", "للحفظ والطباعة", "ونتطلّع إلى ما سنصنعه معاً"].every((t) => welcome.includes(t)));
  chk("وبصيغة المؤنث", welcome.includes("انضمامكِ") && welcome.includes("أنتِ جزءٌ") && welcome.includes("تجدين بطاقتَكِ"));
  const noCard = renderWelcomeEmail({ fullName: "ريم", roleLabel: "عضو", withCard: true, cardInline: false } as never);
  chk("وبلا نسخةٍ مضمّنة لا صورةَ مكسورة", !noCard.includes("cid:tlaqi-card") && noCard.includes("مرفقةٌ بهذه الرسالة"));
  // ═══ عناوينُ الرسائل الأربع (Subject) — واضحةٌ مختصرة بلا شَرطات (قرار المؤسس، نوفمبر 2026) ═══
  const E = await import("@/lib/email");
  chk("عنوانُ الاعتماد باسمه الأول", E.welcomeEmailSubject("ريم الاختبارية") === "ريم، اعتُمد انضمامك إلى TLAQI" && E.welcomeEmailSubject("ريم الاختبارية", "resend") === "ريم، رسالة اعتماد انضمامك إلى TLAQI");
  chk("وعنوانُ التعيين بصيغة صاحبه", E.committeeLeadAppointedSubject("المحتوى الرقمي", "female") === "تعيينكِ قائدةً للجنة المحتوى الرقمي" && E.committeeLeadAppointedSubject("لجنة المحتوى الرقمي", null) === "قرار التعيين لقيادة لجنة المحتوى الرقمي");
  const { captureEmails } = await import("@/lib/emailCapture");
  const poster = { filename: "TLAQI-invitation.png", content: Buffer.from("x"), contentId: "tlaqi-invite" };
  const [inv] = await captureEmails(() => E.sendCredentialsEmail({ to: "x@example.invalid", fullName: "ريم الاختبارية", tempPassword: "Tq-0000", loginUrl: "https://example.test/login", occasion: "invitation", departmentName: "التسويق", invitedByName: "نورة", inviteCard: poster }));
  chk("**وعنوانُ الدعوة بالاسم والقسم**", inv?.subject === "ريم، دعوة للانضمام إلى قسم التسويق في TLAQI", inv?.subject);
  chk("**وملصقُ الدعوة مضمّنٌ (`cid:`) لا رابطٌ خارجي**", inv?.content.image?.src === "cid:tlaqi-invite" && inv?.attachments?.[0]?.contentId === "tlaqi-invite");
  const [invNo] = await captureEmails(() => E.sendCredentialsEmail({ to: "x@example.invalid", fullName: "ريم", tempPassword: "Tq-0000", loginUrl: "https://example.test/login", occasion: "invitation" }));
  chk("وبلا ملصقٍ لا صورةَ (لا صورةَ مكسورة)", !invNo?.content.image && !invNo?.attachments?.length && invNo?.subject === "ريم، دعوة للانضمام إلى فريق TLAQI");
  chk("ونصُّ الدعوة مترابط: الخطواتُ جملةٌ واحدة لا قائمة", (inv?.content.paragraphs ?? []).length === 1 && !(inv?.content.paragraphs ?? [""])[0].includes("<br>") && !inv?.content.after);

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
})();
