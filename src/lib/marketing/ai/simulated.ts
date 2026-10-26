import type { TextProvider } from "./provider";

/** محاكاةٌ للتطوير المحليّ — تختبر الطابورَ والواجهة بلا مزوّدٍ ولا تكلفة.
 *
 *  **ليست ذكاءً اصطناعياً ولا تدّعيه:** كلُّ نسخةٍ تبدأ بعلامة «[محاكاة]»، والمهمّةُ
 *  تُحفظ بمزوّدٍ اسمه `simulated`، والواجهةُ تعرض ذلك. ولا يُختار إلا محلياً
 *  (`registry.ts`). */

export const SIMULATED_MARK = "[محاكاة]";

export function simulatedProvider(): TextProvider {
  return {
    id: "simulated",
    model: "simulated",
    simulated: true,
    async generate(req) {
      const base = req.draft.trim() || req.brief.keyMessage || req.deliverable.title;
      const n = Math.min(Math.max(req.variants, 1), 3);
      return {
        model: "simulated",
        variants: Array.from({ length: n }, (_, i) => ({
          text: `${SIMULATED_MARK} ${i + 1}: ${base}`,
          rationale: `${SIMULATED_MARK} نسخةٌ آليةٌ للاختبار المحلي — لا تُنشر.`,
        })),
      };
    },
  };
}
