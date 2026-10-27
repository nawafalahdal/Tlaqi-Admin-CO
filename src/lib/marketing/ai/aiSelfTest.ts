import { anthropicProvider } from "./anthropic";
import { withTimeout } from "./jobs";
import { ProviderError, type TextProvider } from "./provider";
import { aiDiagnostics } from "./registry";
import { systemPromptFor } from "../chatRules";

/** **فحصُ Claude الحقيقي** — في نشرات المعاينة وحدها، بمفتاح المعاينة المضبوط في Vercel، وبالمسار
 *  نفسه الذي يسلكه الشات (`anthropicProvider().chat` بتعليمات مساعد القسم وسياقٍ مصطنع):
 *    ١) رسالةٌ وردٌّ حقيقي ← ٢) رسالةٌ ثانيةٌ تسأل عن الأولى (السياقُ محفوظٌ عبر التاريخ) ← ٣) مهلةٌ
 *    قصيرةٌ عمداً تُثبت أن انتهاءها خطأٌ مصنَّفٌ يُعاد لا نجاح.
 *  بأقلّ تكلفة: رسالتان قصيرتان، ولا قاعدةَ ولا حملةَ حقيقية. ولا يُعاد من المفتاح ولا من أي متغيّرٍ
 *  شيء — التشخيصُ قيمٌ منطقية (`aiDiagnostics`). */
export async function runAiSelfTest(opts: { env?: Record<string, string | undefined>; provider?: TextProvider } = {}) {
  const env = opts.env ?? process.env;
  const diagnostics = aiDiagnostics(env);
  const steps: { name: string; ok: boolean; ms: number; detail?: unknown }[] = [];
  const key = env.ANTHROPIC_API_KEY?.replace(/\s+/g, "");
  const provider = opts.provider ?? (key ? anthropicProvider({ apiKey: key, model: diagnostics.model }) : null);
  if (!provider?.chat) return { ok: false, diagnostics, steps, reason: "no_key" };

  const system = systemPromptFor("assistant");
  const context = [
    "نوعُ المحادثة: مساعدُ قسم التسويق",
    "الحملة: تجربة — لا تُنشر",
    "الهدف: فحصُ اتصال المنصة بـ Claude",
    "الجمهور: طلابٌ جامعيّون",
    "المنصة: Instagram",
  ].join("\n");
  const first = "اكتب سطرين فقط: منشورٌ قصيرٌ لإنستغرام يدعو إلى ورشةٍ تجريبية. (تجربة — لا تُنشر)";
  let firstReply = "";
  const step = async (name: string, fn: () => Promise<{ ok: boolean; detail?: unknown }>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps.push({ name, ok: r.ok, ms: Date.now() - t0, detail: r.detail });
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: e instanceof ProviderError ? { kind: e.kind, code: e.message } : { error: e instanceof Error ? e.name : "unknown" } });
    }
  };

  await step("message_and_reply", async () => {
    const r = await withTimeout((signal) => provider.chat!({ system, context, history: [], message: first }, signal), 55_000);
    firstReply = r.text;
    return { ok: r.text.trim().length > 0, detail: { model: r.model, usage: r.usage, chars: r.text.length, excerpt: r.text.slice(0, 200) } };
  });
  await step("context_kept", async () => {
    if (!firstReply) return { ok: false, detail: { skipped: "no_first_reply" } };
    const words = firstReply.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
    const r = await withTimeout(
      (signal) => provider.chat!({ system, context, history: [{ role: "user", text: first }, { role: "assistant", text: firstReply }], message: "ما أوّلُ كلمةٍ في ردّك السابق؟ أجب بالكلمة وحدها." }, signal),
      55_000
    );
    const said = r.text.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/)[0] ?? "";
    return { ok: !!said && words.slice(0, 3).includes(said), detail: { model: r.model, usage: r.usage, answer: r.text.slice(0, 60), expectedFirstWord: words[0] ?? "" } };
  });
  await step("timeout_is_classified", async () => {
    try {
      await withTimeout((signal) => provider.chat!({ system, context, history: [], message: "تجربة مهلة — لا تُنشر" }, signal), 1);
      return { ok: false, detail: { unexpected: "completed" } };
    } catch (e) {
      return { ok: e instanceof ProviderError && e.kind === "timeout" && e.retryable, detail: e instanceof ProviderError ? { kind: e.kind, retryable: e.retryable } : { error: "unclassified" } };
    }
  });
  return { ok: steps.every((s) => s.ok), diagnostics, steps };
}
