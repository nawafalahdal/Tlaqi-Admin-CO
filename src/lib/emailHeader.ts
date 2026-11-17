import { EMAIL_BRAND_ASSETS } from "@/lib/brand2026/emailAssets.generated";
import { composeHeader } from "@/lib/brand2026/emailFrames";
import { composeEmail, emailSenderLabel, type EmailContent, type EmailTheme } from "@/lib/emailBrand";
import type { EmailAttachment } from "@/lib/emailCapture";

/** **ترويسةُ البريد بجهتها** — تُرسم وقتَ الإرسال: جهةُ الرسالة (القسم، اللجنة، الإدارة العليا…) بخطّ الهوية على قاعدةٍ مولَّدة
 *  (`emailFrames`). وحدةٌ للخادم وحده (sharp)، فلا يحملها كودُ المتصفح.
 *
 *  - **مخزّنةٌ لكل جهة** في ذاكرة العملية: الجهاتُ معدودة، فلا تُرسم الترويسةُ نفسُها في كل رسالة.
 *  - **ولا تُحجب رسالةٌ لعطبِ خط:** إن لم يُرسم حبرٌ (خطٌّ غائب في بيئة التنفيذ) أو وقع خطأ، عادت `null` — فتُرسل الرسالةُ بالقاعدة
 *    والجهةُ نصٌّ تحتها (`composeEmail` بلا ترويسة). ويُكتب التحذيرُ في السجل ليُرى. */
export const HEADER_CID = "tlaqi-header";
const cache = new Map<string, Buffer | null>();
const CACHE_MAX = 64;

export async function emailHeaderAttachment(label: string): Promise<EmailAttachment | null> {
  const key = label.trim();
  if (!key) return null;
  let png = cache.get(key);
  if (png === undefined) {
    try {
      png = await composeHeader(Buffer.from(EMAIL_BRAND_ASSETS.headerBase.base64, "base64"), key);
      if (!png) console.warn(`[email:header] لم يُرسم اسمُ الجهة «${key}» على الترويسة (الخط؟) — تُرسل بالقاعدة والجهةُ نصّ`);
    } catch (e) {
      console.warn("[email:header] تعذّر رسمُ الترويسة — تُرسل بالقاعدة والجهةُ نصّ:", e instanceof Error ? e.message : e);
      png = null;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, png);
  }
  return png ? { filename: `${HEADER_CID}.png`, content: png, contentId: HEADER_CID } : null;
}

/** **الرسالةُ كما تُرسَل** بترويستها المرسومة — يستعملها مسارُ الإرسال وملفاتُ المعاينة معاً، فلا تختلف المعاينةُ عمّا يصل */
export async function composeEmailWithHeader(opts: { subject: string; content: EmailContent; kind: string; theme?: EmailTheme; attachments?: EmailAttachment[] }) {
  const header = await emailHeaderAttachment(emailSenderLabel(opts.theme));
  return composeEmail({ ...opts, header });
}
