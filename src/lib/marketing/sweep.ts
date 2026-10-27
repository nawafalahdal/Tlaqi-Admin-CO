import { reopenDuePlanning } from "./planningCycle";
import { processDueChats } from "./ai/chat";
import { processDueArchives } from "./archive";

/** كنسُ وكيل التسويق في الجدولة اليومية — ما يجب أن يقع ولو لم يفتح أحدٌ الصفحة:
 *  إعادةُ فتح شات التخطيط في موعده، وردودٌ معلّقةٌ حان إعادتها، وأرشفةٌ معلّقة.
 *
 *  كلُّ خطوةٍ معزولة: فشلُ واحدةٍ لا يوقف غيرها ولا يُسقط بقيّةَ الكنس العام، ويُسجَّل رمزُ
 *  الخطأ وحده بلا نصٍّ ولا مفتاح. وكلُّ خطوةٍ لا تُكرّر ما وقع: الفتحُ مشروطٌ بأنه لم يقع،
 *  والردودُ والأرشفةُ تُحجز ذرّياً قبل معالجتها. */
export async function sweepMarketing(now = new Date()) {
  const out: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      out[name] = await run();
    } catch (e) {
      console.error(`[cron/sweep] marketing ${name} failed:`, e instanceof Error ? e.name : "unknown");
      out[name] = "error";
    }
  };
  await step("planningReopened", () => reopenDuePlanning(now));
  await step("chats", async () => (await processDueChats({ limit: 5, budgetMs: 20_000 })).length);
  await step("archives", () => processDueArchives({ limit: 2, budgetMs: 25_000 }));
  return out;
}
