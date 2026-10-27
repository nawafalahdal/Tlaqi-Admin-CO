import { reopenDuePlanning } from "./planningCycle";
import { processDueChats } from "./ai/chat";
import { processDueArchives, ensureArchiveFile } from "./archive";
import { enqueueMissingPostArchives, processDuePostArchives } from "./postArchive";

/** كنسُ وكيل التسويق في الجدولة اليومية — ما يجب أن يقع ولو لم يفتح أحدٌ الصفحة:
 *  إعادةُ فتح شات التخطيط في موعده، وردودٌ معلّقةٌ حان إعادتها، وأرشفةُ المنشورات المنشورة (وما نُشر
 *  قبل هذه الآلية بلا طلب)، وأرشفةُ الحملات المعلّقة، وفحصُ ملف الأرشيف
 *  (تبويباتُه وعناوينُه — بلا كتابة صفوف) فيظهر في السجلّ يومياً إن انقطع وصولُ المنصة إليه.
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
  await step("postArchivesQueued", () => enqueueMissingPostArchives(20));
  await step("postArchives", () => processDuePostArchives({ limit: 5, budgetMs: 20_000 }));
  await step("archives", () => processDueArchives({ limit: 2, budgetMs: 25_000 }));
  await step("archiveFile", async () => {
    const r = await ensureArchiveFile();
    // أسماءُ التبويبات ورمزُ الخطأ وحدهما — لا معرّفَ الملف ولا بياناتِ الاعتماد
    if (r.error) console.error(`[cron/sweep] marketing archive file: ${r.error}`);
    else if (r.configured) console.info(`[cron/sweep] marketing archive file ready (created: ${r.created?.length ?? 0}, headers fixed: ${r.fixedHeaders?.length ?? 0})`);
    return r;
  });
  return out;
}
