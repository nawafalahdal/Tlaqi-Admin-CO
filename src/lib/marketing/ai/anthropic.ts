import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { CHAT_LIMITS, LIMITS, ProviderError, type ChatRequest, type ChatResult, type TextProvider, type TextRequest, type TextResult } from "./provider";

/** مزوّدُ Claude — عبر المكتبة الرسمية، ولا يُستدعى إلا إذا فُعّل صراحةً (`registry.ts`).
 *
 *  - **مهلةٌ قصيرة وبلا إعادةٍ داخلية:** الطلبُ يجري داخل دالّةٍ لها حدٌّ زمني،
 *    وإعادةُ المحاولة مسؤوليةُ طابور المهامّ (بتأخيرٍ متزايدٍ وحدٍّ معلوم) لا المكتبة.
 *  - **ناتجٌ منظَّم:** مخطّطٌ يُتحقَّق منه (`betaZodOutputFormat`) — فلا يُقبل نصٌّ حرّ
 *    يُقصّ بالتخمين.
 *  - **بديلٌ عند الرفض:** `fallbacks: "default"` — إن رفض النموذجُ لأسباب السلامة
 *    أعاد الخادمُ الطلبَ على نموذجٍ بديلٍ في الطلب نفسه؛ وإن رفضت السلسلةُ كلُّها
 *    فالمهمّةُ «مرفوضة» ولا تُعاد.
 *  - **سببُ التوقّف قبل التحليل:** الرفضُ قد يقطع النصَّ في منتصفه، فيُقرأ
 *    `stop_reason` أولاً ثم يُحلَّل الناتجُ بمخطّطه — وإلا صار الرفضُ «ناتجاً تالفاً».
 *  - **عنوانُ الخادم ثابت:** لا يُقرأ من متغيّرات البيئة، فلا يُرسَل المفتاحُ إلى
 *    مضيفٍ آخر لأن أداةً ما ضبطت `ANTHROPIC_BASE_URL`. */

export const DEFAULT_MODEL = "claude-opus-5-5";
const BASE_URL = "https://api.anthropic.com";
const TIMEOUT_MS = 45_000;
const MAX_TOKENS = 16_000;

const Output = z.object({
  variants: z.array(z.object({ text: z.string(), rationale: z.string() })),
});

function systemPrompt(locale: "ar" | "en") {
  const lang = locale === "ar" ? "العربية الفصحى الواضحة" : "clear, natural English";
  return [
    "أنت مساعدُ كتابةٍ لفريق التسويق في منصة «تَـــلاقِ» — مجتمعٌ طلابيٌّ شعاره «نلتقي · نفكّر · نصنع».",
    "تقترح نصوصاً لمنشورٍ واحدٍ على منصةٍ بعينها، يراجعها كاتبٌ بشريٌّ ويعتمدها أو يرفضها — فاقتراحك مسودةٌ لا قرار.",
    "قواعدُ لا تُخالَف:",
    "- لا تخترع أرقاماً ولا إحصاءاتٍ ولا تواريخ ولا أسماءً ولا شهاداتٍ ولا وعوداً لا ترد في الموجز. وإن احتاج النصُّ معلومةً غيرَ موجودة فاكتب مكانها [يُستكمل: وصفُ المعلومة].",
    "- لا تضع روابطَ إلا ما ورد في الموجز أو المسودة.",
    "- احترم طولَ المنصة المعتادَ وطبيعةَ المقاس (الستوري نصٌّ قصيرٌ يُقرأ في ثوانٍ).",
    `- اكتب بـ${lang} ما لم تطلب التعليماتُ غير ذلك.`,
    "- في `rationale` جملةٌ واحدة: لماذا يناسب هذا النصُّ الجمهورَ والرسالة.",
  ].join("\n");
}

function userPrompt(req: TextRequest) {
  const b = req.brief;
  return [
    `الحملة: ${b.campaign}`,
    `الهدف: ${b.objective ?? "—"}`,
    `الجمهور: ${b.audience ?? "—"}`,
    `الرسالة الرئيسية: ${b.keyMessage ?? "—"}`,
    `المخرج: ${req.deliverable.title} — منصة ${req.deliverable.platform} — مقاس ${req.deliverable.width}×${req.deliverable.height}`,
    `المسودة الحالية:\n${req.draft.slice(0, LIMITS.draft) || "(لا مسودة بعد)"}`,
    `تعليمات الكاتب:\n${req.instructions.slice(0, LIMITS.instructions) || "(لا تعليمات إضافية)"}`,
    `المطلوب: ${Math.min(Math.max(req.variants, 1), LIMITS.variantsMax)} نسخة مختلفة الزاوية.`,
  ].join("\n\n");
}

/** يصنّف فشلَ المكتبة — الأخصُّ أولاً: انقطاعُ المهلة صنفٌ من انقطاع الاتصال، وكلاهما من `APIError`.
 *  ولا يحمل النصُّ شيئاً من الطلب ولا من المفتاح: رمزُ الحالة وحده. */
function classify(e: unknown): ProviderError {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", "timeout");
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError("timeout", "aborted");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("unavailable", "connection");
  if (e instanceof Anthropic.RateLimitError) return new ProviderError("rate_limited", "429");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ProviderError("auth", String(e.status));
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new ProviderError("invalid_request", String(e.status));
  }
  if (e instanceof Anthropic.InternalServerError) return new ProviderError("unavailable", String(e.status));
  if (e instanceof Anthropic.APIError) return new ProviderError("unknown", String(e.status ?? "api"));
  return new ProviderError("bad_output", "parse");
}

/** تاريخُ المحادثة كما يقبله المزوّد: يبدأ بالمستخدم، ويتناوب، ومقصوصٌ عدداً وطولاً.
 *  ردٌّ فشل أو بطل لا يُرسَل، فقد تتجاور رسالتان من المستخدم — تُدمجان. */
export function chatMessages(req: ChatRequest) {
  const turns = [...req.history.slice(-CHAT_LIMITS.historyMessages), { role: "user" as const, text: req.message }]
    .map((t) => ({ role: t.role, text: t.text.slice(0, CHAT_LIMITS.historyChars).trim() }))
    .filter((t) => t.text);
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.text}`;
    else out.push({ role: t.role, content: t.text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function anthropicProvider(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): TextProvider {
  const model = opts.model || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: BASE_URL, timeout: TIMEOUT_MS, maxRetries: 0, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const format = betaZodOutputFormat(Output);
  return {
    id: "anthropic",
    model,
    simulated: false,
    async generate(req, signal): Promise<TextResult> {
      let response;
      try {
        // `create` لا `parse`: الثاني يحلّل قبل أن نرى سببَ التوقّف (انظر أعلاه).
        // وترويسةُ الناتج المنظَّم هي ما يضيفه `parse` نفسه.
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            betas: ["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"],
            fallbacks: "default",
            output_config: { effort: "medium", format },
            system: systemPrompt(req.locale),
            messages: [{ role: "user", content: userPrompt(req) }],
          },
          { signal }
        );
      } catch (e) {
        throw classify(e);
      }
      if (response.stop_reason === "refusal") throw new ProviderError("refused", response.stop_details?.category ?? "refusal");
      if (response.stop_reason === "max_tokens") throw new ProviderError("bad_output", "max_tokens");
      let parsed: z.infer<typeof Output>;
      try {
        const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        parsed = format.parse(text);
      } catch {
        throw new ProviderError("bad_output", "schema");
      }
      const variants = parsed.variants
        .map((v) => ({ text: v.text.trim(), rationale: v.rationale.trim() }))
        .filter((v) => v.text)
        .slice(0, LIMITS.variantsMax);
      if (variants.length === 0) throw new ProviderError("bad_output", "empty");
      return {
        variants,
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },

    /** ردٌّ نصّيٌّ في سياق مهمّة. السياقُ في تعليمات النظام موسوماً بأنه بيانات — فما كتبه أحدٌ في
     *  موجزٍ أو مسودةٍ لا يصير تعليمة. ولا أدواتَ تُعطى للنموذج: لا يملك أن يعتمد أو ينشر أو يعدّل. */
    async chat(req, signal): Promise<ChatResult> {
      const messages = chatMessages(req);
      if (messages.length === 0) throw new ProviderError("invalid_request", "empty");
      let response;
      try {
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: CHAT_LIMITS.replyTokens,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "medium" },
            system: `${req.system}\n\n<task_context>\n${req.context.slice(0, CHAT_LIMITS.context)}\n</task_context>`,
            messages,
          },
          { signal }
        );
      } catch (e) {
        throw classify(e);
      }
      if (response.stop_reason === "refusal") throw new ProviderError("refused", response.stop_details?.category ?? "refusal");
      if (response.stop_reason === "max_tokens") throw new ProviderError("bad_output", "max_tokens");
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      if (!text) throw new ProviderError("bad_output", "empty");
      return { text, model: response.model, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
    },
  };
}
