/** يتحقق أن كل قائمةِ «أعضاءٍ معتمَدين» تمرّ بشرط القائمة.
 *
 *  **الضمانة التي يحرسها:** صفُّ المرشّح القيادي (رئيسٌ تنفيذي، مسؤول
 *  متابعة وتشغيل، قائدُ قسم) يبقى `approved` في `Member` بعد ترقيته إلى
 *  حسابٍ إداري. فكلُّ قائمةٍ تسأل `approvalStatus: "approved"` وحده تُعيد
 *  الرئيسَ التنفيذيَّ عضواً عادياً — وهي الحادثةُ المُبلَّغ عنها.
 *
 *  فكلُّ قائمةٍ كهذه إمّا تمرّ بـ`ROSTER_MEMBER_WHERE`، أو تُسمّي المنصب
 *  الذي تريده (`targetRole`)، أو تُعلن بسطرٍ مكتوب:
 *  `// member-roster: all — <السبب>`.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

// والقائمةُ المتداخلة في قراءة قسمٍ (`members: { where: … }`) قائمةُ أعضاءٍ أيضاً — منها
// أفلت الهيكل: كان يسأل «المعتمَد» وحده، فظهر سجلُّ ترشّح القائد السابق عضواً بعد حذف حسابه
const CALL = /prisma\.member\.(findMany|findFirst|count)\s*\(|\bmembers:\s*\{/g;
const ESCAPE = /member-roster:\s*all/;

/** نصُّ الكائن من قوسه المفتوح عند `open` حتى قوسه المغلق */
function braced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

let failed = false;
let scoped = 0;
let declared = 0;

for (const file of walk("src")) {
  if (file.endsWith(join("lib", "roster.ts"))) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(CALL)) {
    const at = match.index ?? 0;
    // القائمةُ المتداخلة تُقرأ بحدود قوسها وحده: النافذةُ الثابتة تبلغ الجملةَ التالية
    // فتجد شرطَها هناك وتَعُدّه لهذه
    const window = match[0].startsWith("members") ? braced(source, at + match[0].length - 1) : source.slice(at, at + 500);
    const before = source.slice(Math.max(0, at - 240), at);
    const line = source.slice(0, at).split("\n").length;
    // ما لا يسأل عن «المعتمَد» ليس قائمةَ أعضاء: مرشّحون، أو بحثٌ ببريد
    if (!/approvalStatus:\s*"approved"/.test(window) && !window.includes("ROSTER_MEMBER_WHERE")) continue;
    if (window.includes("ROSTER_MEMBER_WHERE") || window.includes("targetRole")) {
      scoped++;
      continue;
    }
    if (ESCAPE.test(before) || ESCAPE.test(window)) {
      declared++;
      continue;
    }
    console.error(
      `✗ ${file}:${line} — قائمةُ أعضاءٍ معتمَدين تَعُدّ القادةَ المرقَّين أعضاءً: مرّرها بـROSTER_MEMBER_WHERE، أو أعلن «member-roster: all» بسببه`
    );
    failed = true;
  }
}

if (scoped === 0) {
  console.error("✗ لم يُعثر على أي قائمة أعضاء — تغيّر شكل النداء وبطل الفحص");
  failed = true;
}

if (failed) process.exit(1);
console.log(`✓ قوائم الأعضاء: ${scoped} بشرط القائمة، ${declared} معلَنةٌ بالكل`);
