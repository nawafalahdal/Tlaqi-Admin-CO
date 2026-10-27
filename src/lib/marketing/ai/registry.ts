import { deploymentEnv } from "@/lib/deploymentEnv";
import { anthropicProvider, DEFAULT_MODEL } from "./anthropic";
import { simulatedProvider } from "./simulated";
import type { TextProvider } from "./provider";

/** هل التوليدُ متاحٌ الآن؟ — من الإعدادات وحدها، ولا يُخمَّن ولا يُدّعى.
 *
 *  لمزوّد Claude ثلاثةُ شروطٍ معاً، وغيابُ أيٍّ منها يُبقيه معطّلاً بحالةٍ مسمّاة:
 *  ١) `MARKETING_AI_PROVIDER=anthropic` (أو `claude`) — اختيارُ المزوّد.
 *  ٢) `ANTHROPIC_API_KEY` — المفتاح (يُقرأ وجودُه ولا يُطبع، وتُزال مسافاتٌ أو أسطرٌ نُسخت معه).
 *  ٣) `MARKETING_AI_ENABLED=1` (أو `true`/`yes`/`on`) — موافقةُ المالك على التكلفة. بدونه لا طلبَ مدفوعاً.
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

/** قيمُ التفعيل المقبولة — «1» وما يكتبه الناسُ عادةً بمعناه («true»، «yes»، «on») بلا فرقٍ في الحالة
 *  أو المسافات. وما سواها ليس تفعيلاً (ومنه «0» و«false»): الموافقةُ صريحةٌ أو لا تكون. */
const ON = new Set(["1", "true", "yes", "on"]);
/** أسماءُ المزوّد المقبولة — «claude» هو Anthropic نفسه */
const PROVIDERS: Record<string, "anthropic" | "simulated"> = { anthropic: "anthropic", claude: "anthropic", "claude-api": "anthropic", simulated: "simulated" };
/** المفتاحُ بلا مسافاتٍ ولا أسطرٍ نُسخت معه — فلا يُرفض مفتاحٌ صحيحٌ بسطرٍ زائد */
const keyOf = (env: Env) => env.ANTHROPIC_API_KEY?.replace(/\s+/g, "") || undefined;

export function aiStatus(env: Env = process.env): AiStatus {
  const image = { state: "not_configured" as const, reason: "no_image_provider" };
  const raw = env.MARKETING_AI_PROVIDER?.trim().toLowerCase();
  const provider = raw ? PROVIDERS[raw] ?? raw : undefined;
  const off = (state: AiState, reason: string, p: string | null = provider ?? null) => ({
    text: { state, provider: p, model: null, simulated: false, reason },
    image,
  });
  if (!provider) return off("not_configured", "no_provider", null);
  if (provider === "anthropic") {
    if (!keyOf(env)) return off("not_configured", "no_key");
    if (deploymentEnv(env) === "preview") return off("disabled", "preview");
    if (!ON.has(env.MARKETING_AI_ENABLED?.trim().toLowerCase() ?? "")) return off("disabled", "not_enabled");
    return { text: { state: "ready", provider, model: env.MARKETING_AI_MODEL?.trim() || DEFAULT_MODEL, simulated: false, reason: null }, image };
  }
  if (provider === "simulated") {
    if (deploymentEnv(env) !== "development" || env.NODE_ENV !== "development") return off("disabled", "simulated_not_allowed");
    return { text: { state: "ready", provider, model: "simulated", simulated: true, reason: null }, image };
  }
  return off("not_configured", "unknown_provider");
}

/** تشخيصُ الإعداد بلا قيمة — ما يُطبع في سجلّ البناء ويُعاد في فحص المعاينة: أيُّ شرطٍ ناقصٌ بالضبط،
 *  ولا يظهر من المفتاح ولا من أي متغيّرٍ حرفٌ واحد. */
export function aiDiagnostics(env: Env = process.env) {
  const raw = env.MARKETING_AI_PROVIDER?.trim().toLowerCase();
  const enabled = env.MARKETING_AI_ENABLED?.trim().toLowerCase();
  const key = env.ANTHROPIC_API_KEY;
  return {
    deployment: deploymentEnv(env),
    provider: !raw ? "missing" : PROVIDERS[raw] ?? "unrecognized",
    providerWasAlias: !!raw && raw !== "anthropic" && PROVIDERS[raw] === "anthropic",
    keyPresent: !!keyOf(env),
    keyHadWhitespace: !!key && key !== key.replace(/\s+/g, ""),
    keyLooksLikeAnthropic: !!keyOf(env)?.startsWith("sk-ant-"),
    enabledFlag: enabled === undefined || enabled === "" ? "missing" : ON.has(enabled) ? (enabled === "1" ? "on" : "on_alias") : "off",
    modelOverride: !!env.MARKETING_AI_MODEL?.trim(),
    model: env.MARKETING_AI_MODEL?.trim() || DEFAULT_MODEL,
    status: aiStatus(env).text,
  };
}

export function textProvider(env: Env = process.env): TextProvider | null {
  const s = aiStatus(env).text;
  if (s.state !== "ready") return null;
  if (s.provider === "anthropic") return anthropicProvider({ apiKey: keyOf(env)!, model: s.model ?? undefined });
  if (s.provider === "simulated") return simulatedProvider();
  return null;
}
