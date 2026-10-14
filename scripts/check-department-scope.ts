/** يتحقق أن كل قائمةِ أقسام تُقرأ بنطاقٍ مصرَّح به.
 *
 *  **الضمانة التي يحرسها:** اللجنةُ قسمٌ له أبٌ، فكلُّ `department.findMany`
 *  قائمةٌ قد تَسحب معها لجنةً **مقترحةً لم تُعتمد** — فتظهر وجهةً لتذكرة،
 *  أو خياراً في نموذج دعوة، أو صفّاً في تقرير. والاقتراحُ ليس فتحاً.
 *
 *  فكلُّ قائمةٍ إمّا تمرّ بـ`OPEN_DEPARTMENT_WHERE`، أو تُعلن أنها تريد
 *  الكلَّ بسطرٍ مكتوب: `// department-scope: all — <السبب>`. والقائمةُ
 *  الجديدةُ التي تنسى الاثنين يُوقفها البناء — لأن النسيان هنا لا يُرى
 *  في الشاشة إلا بعد أن يراه عضو.
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

const CALL = /prisma\.department\.findMany\s*\(/g;
const ESCAPE = /department-scope:\s*all/;

let failed = false;
let scoped = 0;
let declared = 0;

for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(CALL)) {
    const at = match.index ?? 0;
    // نافذةُ النداء: ما بعده حتى ٦٠٠ محرف تكفي لوسيطه الأول
    const window = source.slice(at, at + 600);
    // وسطرانِ قبله: موضعُ الإعلان الصريح
    const before = source.slice(Math.max(0, at - 240), at);
    const line = source.slice(0, at).split("\n").length;

    if (window.includes("OPEN_DEPARTMENT_WHERE")) {
      scoped++;
      continue;
    }
    if (ESCAPE.test(before) || ESCAPE.test(window)) {
      declared++;
      continue;
    }
    console.error(
      `✗ ${file}:${line} — قائمةُ أقسامٍ بلا نطاق: مرّرها بـOPEN_DEPARTMENT_WHERE، أو أعلن «department-scope: all» بسببه`
    );
    failed = true;
  }
}

if (scoped + declared === 0) {
  console.error("✗ لم يُعثر على أي قائمة أقسام — تغيّر شكل النداء وبطل الفحص");
  failed = true;
}

if (failed) process.exit(1);
console.log(`✓ قوائم الأقسام: ${scoped} بنطاق المفتوحة، ${declared} معلَنةٌ بالكل`);
