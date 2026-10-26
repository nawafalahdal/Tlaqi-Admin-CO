import { deploymentEnv } from "@/lib/deploymentEnv";
import { anthropicProvider, DEFAULT_MODEL } from "./anthropic";
import { simulatedProvider } from "./simulated";
import type { TextProvider } from "./provider";

/** هل التوليدُ متاحٌ الآن؟ — من الإعدادات وحدها، ولا يُخمَّن ولا يُدّعى.
 *
 *  لمزوّد Claude ثلاثةُ شروطٍ معاً، وغيابُ أيٍّ منها يُبقيه معطّلاً بحالةٍ مسمّاة:
 *  ١) `MARKETING_AI_PROVIDER=anthropic` — اختيارُ المزوّد.
 *  ٢) `ANTHROPIC_API_KEY` — المفتاح (يُقرأ وجودُه ولا يُطبع).
 *  ٣) `MARKETING_AI_ENABLED=1` — موافقةُ المالك على التكلفة. بدونه لا طلبَ مدفوعاً.
 *  ولا يعمل في نشرة معاينةٍ أبداً.
 *
 *  و«المحاكاة» (`simulated`) للتطوير المحليّ وحده: تختبر الطابورَ والواجهة بلا
 *  مزوّد، وكلُّ ناتجٍ لها معلَّمٌ أنه محاكاة — لا يُعرض كذكاءٍ اصطناعي.
 *
 *  وتوليدُ الصور لا مزوّدَ له بعد: حالتُه «غيرُ مهيّأ» صراحةً. */

type Env = Record<string, string | undefined>;

export type AiState = "ready" | "not_configured" | "disabled";
export type AiStatus = {
  text: { state: AiState; provider: string | null; model: string | null; simulated: boolean; reason: string | null };
  image: { state: AiState; reason: string };
};

export function aiStatus(env: Env = process.env): AiStatus {
  const image = { state: "not_configured" as const, reason: "no_image_provider" };
  const provider = env.MARKETING_AI_PROVIDER?.trim().toLowerCase();
  const off = (state: AiState, reason: string, p: string | null = provider ?? null) => ({
    text: { state, provider: p, model: null, simulated: false, reason },
    image,
  });
  if (!provider) return off("not_configured", "no_provider", null);
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return off("not_configured", "no_key");
    if (deploymentEnv(env) === "preview") return off("disabled", "preview");
    if (env.MARKETING_AI_ENABLED !== "1") return off("disabled", "not_enabled");
    return { text: { state: "ready", provider, model: env.MARKETING_AI_MODEL?.trim() || DEFAULT_MODEL, simulated: false, reason: null }, image };
  }
  if (provider === "simulated") {
    if (deploymentEnv(env) !== "development" || env.NODE_ENV !== "development") return off("disabled", "simulated_not_allowed");
    return { text: { state: "ready", provider, model: "simulated", simulated: true, reason: null }, image };
  }
  return off("not_configured", "unknown_provider");
}

export function textProvider(env: Env = process.env): TextProvider | null {
  const s = aiStatus(env).text;
  if (s.state !== "ready") return null;
  if (s.provider === "anthropic") return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY!, model: s.model ?? undefined });
  if (s.provider === "simulated") return simulatedProvider();
  return null;
}
