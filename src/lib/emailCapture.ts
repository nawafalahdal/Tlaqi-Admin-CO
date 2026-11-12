import { AsyncLocalStorage } from "node:async_hooks";
import type { EmailContent, EmailTheme } from "@/lib/emailBrand";

/** **التقاطُ البريد للمعاينة** — داخل `captureEmails` لا يُرسَل شيءٌ ولا يُسجَّل: تُجمع الرسالةُ كما بنتها
 *  دالتُها الحقيقية (عنوانها ومحتواها ونوعها) لتُعرض في مركز مراجعة الهوية بالقالبين القديم والجديد.
 *  فالمعاينةُ لا تكتب نصّاً موازياً للرسالة: نصُّها نصُّ الرسالة نفسها، بمتغيّراتٍ تجريبية. */
export type CapturedEmail = { to: string[]; subject: string; content: EmailContent; kind: string; theme?: EmailTheme };

const store = new AsyncLocalStorage<CapturedEmail[]>();

export function capturingEmails(): CapturedEmail[] | null {
  return store.getStore() ?? null;
}

export async function captureEmails(fn: () => Promise<unknown>): Promise<CapturedEmail[]> {
  const box: CapturedEmail[] = [];
  await store.run(box, fn);
  return box;
}
