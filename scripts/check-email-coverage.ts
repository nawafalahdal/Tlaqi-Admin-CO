/** يتحقق أن كل وسم نوع مستعمل في email.ts له تصميم مُسنَد صراحةً.
 *
 *  الضمانة التي يحرسها هذا الفحص: لا تخرج رسالة من المنصة بلا هوية، ولا
 *  تأخذ رسالةٌ تصميماً عاماً لأن أحداً نسي إسنادها. يُشغَّل مع البناء.
 */
import { readFileSync } from "fs";
import { variantForKind } from "../src/lib/emailBrand";

const source = readFileSync("src/lib/email.ts", "utf8");

// الوسم يُلتقط بموضعه من النداء لا بشكله وحده: سطرٌ بين علامتي اقتباس،
// يليه اختيارياً وسيطٌ واحد (ترويسة خاصة لبعض الرسائل)، ثم إغلاق النداء.
//
// الربط بالإغلاق ضروري: عنوان الرسالة أيضاً سطرٌ بين علامتي اقتباس، فلو
// قُبل كل سطرٍ كهذا لعُدّت العناوين أنواعاً وامتلأ الفحص بإنذارات كاذبة.
// ولو اشتُرط ألّا فاصلة بعده لسقط كل وسمٍ يليه وسيط — وهو ما أخفى
// "ترحيب" صامتاً.
const kinds = Array.from(
  new Set(
    Array.from(
      source.matchAll(/^\s+"([^"]+)"(?:,\s*\n\s*[A-Za-z_$][\w$.]*)?,?\s*\n\s*\);/gm),
      (m) => m[1]
    )
  )
);

// تعريف الدالة نفسها يبدأ بـ `send(` في آخر سطره منذ صار متعدّد الأسطر،
// فيُستثنى صراحةً وإلا عُدَّ نداءً ولم يُوجد له وسم
const sendCalls =
  (source.match(/\bsend\(\s*$/gm) ?? []).length -
  (source.match(/^async function send\(\s*$/gm) ?? []).length;

let failed = false;
console.log(`نداءات الإرسال: ${sendCalls} — أنواع مميّزة: ${kinds.length}\n`);

const byVariant = new Map<string, string[]>();
for (const kind of kinds.sort()) {
  const variant = variantForKind(kind);
  const explicit = variant !== "default" || ["دعوة", "بيانات الدخول", "استعادة كلمة المرور", "إعلان عام"].includes(kind);
  if (!explicit) {
    console.error(`✗ "${kind}" بلا تصميم مُسنَد — سيأخذ العام افتراضاً`);
    failed = true;
  }
  byVariant.set(variant, [...(byVariant.get(variant) ?? []), kind]);
}

for (const [variant, list] of byVariant) {
  console.log(`${variant.padEnd(12)} (${list.length}): ${list.join("، ")}`);
}

// كل نداء إرسال لا بدّ أن يقابله وسم. النقص يعني نداءً بلا وسم، وهو
// بالضبط الباب الذي تفلت منه رسالة بلا تصميم.
if (kinds.length === 0) {
  console.error("\n✗ لم يُعثر على أي وسم — تغيّر شكل الملف وبطل الفحص");
  failed = true;
} else if (kinds.length < sendCalls) {
  console.error(
    `\n✗ ${sendCalls} نداء إرسال مقابل ${kinds.length} وسماً — هناك نداء بلا وسم نوع`
  );
  failed = true;
}

if (failed) process.exit(1);
console.log("\n✓ كل نوع رسالة له تصميم مُسنَد صراحةً");
