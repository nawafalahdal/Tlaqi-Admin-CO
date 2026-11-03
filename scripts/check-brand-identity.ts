/** يتحقق من الهوية المعتمدة (TLAQI) في الشهادات والبريد — بلا قاعدة ولا بريد ولا شبكة.
 *
 *  ١) حبرُ التوقيع يُختار من خلفية منطقته: Temptress أو Beige الأعلى تبايناً (المصفوفة المعتمدة).
 *  ٢) ألوانُ «الإطار الكلاسيكي» من لون القسم: البيجُ الذائب في الورق يأخذ Temptress، والأخضرُ إطارٌ لا عنوان.
 *  ٣) مدّةُ المشاركة بالعربية الصحيحة: «٣ أشهر»، «٤ أشهر و١٢ يوماً»، «شهران ويومان».
 *  ٤) رسالةُ تعيين قائد اللجنة: الشعارُ المعتمد مع الاسم الكامل، بلا الاسم العربي ولا هاشتاق، وبجنس صاحبها.
 *  ٥) الرسائلُ الأخرى: القالبُ الموحَّد كما كان (الشعار الصغير والجملة)، ولا يظهر فيها الجديد.
 *  ٦) ملفّا الشعار المعتمد موجودان، شفّافان، بدقّة الملف الرسمي (٨٨٠ عرضاً).
 *
 *  تشغيله: npx tsx scripts/check-brand-identity.ts */
import { readFileSync } from "fs";
import { inkForBackground, certificateFrame, serviceDurationAr, CERTIFICATE_PAPER } from "../src/lib/certificate";
import { renderEmail } from "../src/lib/emailBrand";
import { committeeLeadAppointedContent } from "../src/lib/email";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failed++;
}
const eq = (label: string, got: unknown, want: unknown) => check(label, got === want, `got ${String(got)} want ${String(want)}`);

const T = "#341D2B", B = "#EEF6DF";

// ١) حبر منطقة التوقيع — كما في لوحة المنطق المعتمدة
eq("التوقيع على الورق ← Temptress", inkForBackground(CERTIFICATE_PAPER), T);
eq("التوقيع على Beige ← Temptress", inkForBackground("#EEF6DF"), T);
eq("التوقيع على Green Sheen ← Temptress", inkForBackground("#67C090"), T);
eq("التوقيع على Mahogany ← Beige", inkForBackground("#C34900"), B);
eq("التوقيع على Temptress ← Beige", inkForBackground("#341D2B"), B);
eq("لونٌ غير صالح ← Temptress (آمن)", inkForBackground("red"), T);

// ٢) ألوان الإطار الكلاسيكي
const mkt = certificateFrame("#C34900");
check("التسويق: الإطار والعنوان Mahogany والرمز Beige", mkt.frame === "#C34900" && mkt.accent === "#C34900" && mkt.sealInk === B, JSON.stringify(mkt));
const tech = certificateFrame("#67C090");
check("التقنية: الإطار أخضر، والعنوان Temptress (الأخضر باهتٌ نصّاً)، والرمز Temptress", tech.frame === "#67C090" && tech.accent === T && tech.sealInk === T, JSON.stringify(tech));
const hr = certificateFrame("#EEF6DF");
check("الموارد البشرية: البيج يذوب في الورق ← إطار Temptress", hr.frame === T && hr.accent === T && hr.sealInk === B, JSON.stringify(hr));
const none = certificateFrame(null);
check("بلا لون قسم ← Temptress", none.frame === T, JSON.stringify(none));
eq("حبر التوقيع في القالب = حبر الورق", mkt.signatureInk, T);

// ٣) المدّة — بتواريخ منتصف النهار (توقيت المنظمة: الرياض)
const d = (s: string) => new Date(`${s}T12:00:00Z`);
eq("ثلاثة أشهر تامّة", serviceDurationAr(d("2026-07-01"), d("2026-10-01")), "٣ أشهر");
eq("أشهرٌ وأيام", serviceDurationAr(d("2026-07-01"), d("2026-11-13")), "٤ أشهر و١٢ يوماً");
eq("أيامٌ فقط", serviceDurationAr(d("2026-07-01"), d("2026-07-19")), "١٨ يوماً");
eq("المفرد", serviceDurationAr(d("2026-07-01"), d("2026-08-02")), "شهر واحد ويوم واحد");
eq("المثنى", serviceDurationAr(d("2026-07-01"), d("2026-09-03")), "شهران ويومان");
eq("أحد عشر فما فوق", serviceDurationAr(d("2025-08-01"), d("2026-07-01")), "١١ شهراً");
eq("لا مدّة", serviceDurationAr(d("2026-07-01"), d("2026-07-01")), "أقل من يوم");

// ٤) رسالة تعيين قائد اللجنة
const base = {
  fullName: "سارة عبدالله المثال",
  committeeName: "المحتوى الرقمي",
  parentName: "التسويق",
  appointedByName: "قائدة قسم التسويق",
  url: "https://example.test/committees/x",
  appointedAt: d("2026-09-15"),
};
const female = committeeLeadAppointedContent(base, "female");
const male = committeeLeadAppointedContent({ ...base, fullName: "فيصل ناصر" }, "male");
const neutral = committeeLeadAppointedContent({ ...base, committeeName: "لجنة المحتوى الرقمي" }, null);
const html = renderEmail({ subject: female.title, content: female, theme: { departmentName: "التسويق", colorHex: "#C34900" } }).html;
check("التذييل بالشعار المعتمد مع الاسم الكامل", html.includes("/brand/logo-fullname-on-dark.png") && html.includes('alt="TLAQI — Talent Link Advancing Quality Innovation"'));
check("لا الاسم العربي في الرسالة", !/تَـــلاقِ|تلاقي|تلاق/.test(html));
check("لا الجملة القديمة ولا أي هاشتاق (رسالةٌ إدارية)", !html.includes("نلتقي") && !/#[؀-ۿ]/.test(html));
check("رأسُ التهنئة: التحية باسمها الأول والسطرُ بصيغة المؤنث", html.includes("مبارك يا سارة!") && html.includes("أنتِ الآن قائدةُ «لجنة المحتوى الرقمي»"));
check("الحقول الخمسة مع تاريخ التعيين بالعربية", ["اللجنة", "القسم", "المسمى القيادي", "تاريخ التعيين", "صدر التعيين من", "١٥ سبتمبر ٢٠٢٦"].every((s) => html.includes(s)));
check("الخطوات الأولى مرقّمة", html.includes("خطواتكِ الأولى") && html.includes("افتحي صفحة اللجنة"));
check("صيغة المذكّر", male.hero?.subtitle === "أنتَ الآن قائدُ «لجنة المحتوى الرقمي»" && (male.steps?.items[0] ?? "").startsWith("افتح "));
check("الصيغة المحايدة لمن لم يختر، ولا تتكرّر «لجنة»", neutral.hero?.subtitle === "أنت الآن قائدُ «لجنة المحتوى الرقمي»" && (neutral.steps?.items[0] ?? "").startsWith("فتحُ"));
check("اسم اللجنة يُهرَّب", !renderEmail({ subject: "x", content: committeeLeadAppointedContent({ ...base, committeeName: "<b>x</b>" }, "female") }).html.includes("<b>x</b>"));

// ٥) الرسائل الأخرى كما كانت
const other = renderEmail({ subject: "عام", content: { title: "عنوان", lead: "متن" }, theme: { departmentName: "التقنية", colorHex: "#67C090" } }).html;
check("الرسائل الأخرى: الشعار الصغير والجملة كما هما", other.includes('width="96" height="28"') && other.includes("نلتقي"));
check("الرسائل الأخرى: لا الشعار الجديد ولا رأس التهنئة", !other.includes("logo-fullname") && !other.includes("tq-hero"));

// ٦) ملفّا الشعار المعتمد: PNG بقناة شفافية، ٨٨٠ عرضاً
for (const tone of ["light", "dark"]) {
  const buf = readFileSync(`public/brand/logo-fullname-on-${tone}.png`);
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), colorType = buf[25];
  check(`logo-fullname-on-${tone}.png: PNG شفاف ٨٨٠×٣١٨`, png && w === 880 && h === 318 && colorType === 6, `png=${png} ${w}×${h} type=${colorType}`);
}
const page = readFileSync("src/app/certificate/[token]/page.tsx", "utf8");
check("الشهادة: الشعار المعتمد، ولا الاسم العربي، ولا تاريخ «اليوم»", page.includes("/brand/logo-fullname-on-light.png") && !page.includes("تَـــلاقِ") && !page.includes("new Date()"));

console.log(failed ? `\n✗ ${failed} فحصاً فشل` : "\n✓ الهوية المعتمدة سليمة");
process.exit(failed ? 1 : 0);
