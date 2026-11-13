import { firstName } from "../src/lib/personName";

/** الاسمُ الأول في التحيات والبطاقات: الأسماءُ المركّبة لا تُقطع («عبد الرحمن» لا «عبد») */
const cases: [string, string][] = [
  ["سارة أحمد المثال", "سارة"],
  ["  سارة   أحمد ", "سارة"],
  ["عبد الرحمن بن محمد العبدالله", "عبد الرحمن"],
  ["عبدالرحمن محمد", "عبدالرحمن"],
  ["عبد الله", "عبد الله"],
  ["أبو بكر الصديق", "أبو بكر"],
  ["نور الدين محمود", "نور الدين"],
  ["جار الله العتيبي", "جار الله"],
  ["محمد", "محمد"],
  ["John Smith", "John"],
  ["", ""],
];
let failed = 0;
for (const [input, want] of cases) {
  const got = firstName(input);
  if (got !== want) {
    failed++;
    console.error(`✗ «${input}» → «${got}» (المتوقع «${want}»)`);
  }
}
if (failed) process.exit(1);
console.log(`✓ الاسم الأول: ${cases.length} حالة`);
