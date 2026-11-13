/** **الاسمُ الأول** للتحية والعناوين القصيرة («أهلاً سارة»، «سارة، هذه دعوتك»).
 *
 *  الكلمةُ الأولى وحدها تخطئ في الأسماء العربية المركّبة: «عبد الرحمن» تصير «عبد»، و«نور الدين» تصير «نور». فتُضمّ
 *  الكلمةُ الثانية حين تكون الأولى «عبد» أو «أبو» (عبد الله، أبو بكر)، أو حين تكون الثانية «الله» أو «الدين»
 *  (جار الله، صلاح الدين). وما سوى ذلك فالكلمةُ الأولى، والاسمُ كاملاً إن خلا من المسافات. */
const JOINS_NEXT = new Set(["عبد", "أبو", "ابو", "أبي", "ابي"]);
const JOINS_PREV = new Set(["الله", "الدين"]);

export function firstName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fullName.trim();
  if (words.length > 1 && (JOINS_NEXT.has(words[0]) || JOINS_PREV.has(words[1]))) return `${words[0]} ${words[1]}`;
  return words[0];
}
