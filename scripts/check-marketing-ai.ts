import { anthropicProvider, DEFAULT_MODEL } from "@/lib/marketing/ai/anthropic";
import { ProviderError, type TextRequest } from "@/lib/marketing/ai/provider";
import { aiStatus, textProvider } from "@/lib/marketing/ai/registry";
import { simulatedProvider, SIMULATED_MARK } from "@/lib/marketing/ai/simulated";

/** طبقةُ المزوّد — بلا شبكةٍ ولا مفتاحٍ حقيقيٍّ ولا تكلفة.
 *
 *  ١) **البوّابة:** متى يكون التوليدُ «جاهزاً» ومتى «غيرَ مهيّأ» أو «معطّلاً» —
 *     ولا يعمل في المعاينة، ولا يعمل بلا موافقة التكلفة، والمحاكاةُ محليّةٌ فقط.
 *  ٢) **مزوّدُ Claude** عبر المكتبة الرسمية، و`fetch` مُحقَن يردّ كما يردّ الخادم:
 *     نجاح، ٤٢٩، ٥٠٠، ٤٠٠، ٤٠١، رفض، قصّ، ناتجٌ لا يطابق المخطّط، انقطاعُ اتصال،
 *     وإلغاءٌ بالمهلة. ويُفحص ما أُرسل: النموذج، والبديلُ عند الرفض، والمخطّط —
 *     وأن الطلب لا يحمل بياناتٍ شخصية. */

const checks: string[] = [];
const chk = (n: string, ok: boolean, extra = "") => checks.push(`${ok ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`);

const FAKE_KEY = "sk-ant-test-not-a-real-key";
const req: TextRequest = {
  brief: { campaign: "حملة الإطلاق", objective: "تعريفٌ بالمنصة", audience: "طلاب الجامعات", keyMessage: "نلتقي ونفكّر ونصنع" },
  deliverable: { title: "ستوري الإطلاق", platform: "instagram", width: 1080, height: 1920 },
  draft: "مسودة أولى",
  instructions: "أقصر وأوضح",
  variants: 2,
  locale: "ar",
};

type Sent = { url: string; headers: Headers; body: Record<string, unknown> };

function message(over: Record<string, unknown> = {}, text = JSON.stringify({ variants: [{ text: "نصٌّ أول", rationale: "سبب" }, { text: "نصٌّ ثانٍ", rationale: "سبب" }] })) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 80 },
    ...over,
  };
}

function fakeFetch(reply: (sent: Sent) => Response | Promise<Response>, log: Sent[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const sent: Sent = { url, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : {} };
    log.push(sent);
    return reply(sent);
  }) as typeof fetch;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const apiError = (status: number, type: string) => json(status, { type: "error", error: { type, message: type } });

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ProviderError ? `${e.kind}${e.retryable ? "+retry" : ""}` : `raw:${(e as Error)?.name}`;
  }
}

(async () => {
  // ── ١) البوّابة
  const dev = { NODE_ENV: "development" };
  chk("بلا مزوّد: «غيرُ مهيّأ»", aiStatus(dev).text.state === "not_configured" && aiStatus(dev).text.reason === "no_provider");
  chk("مزوّدٌ بلا مفتاح: «غيرُ مهيّأ»", aiStatus({ ...dev, MARKETING_AI_PROVIDER: "anthropic" }).text.reason === "no_key");
  const noConsent = aiStatus({ ...dev, MARKETING_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_KEY });
  chk("مفتاحٌ بلا موافقة التكلفة: «معطّل»", noConsent.text.state === "disabled" && noConsent.text.reason === "not_enabled");
  const ready = aiStatus({ ...dev, MARKETING_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_KEY, MARKETING_AI_ENABLED: "1" });
  chk("الثلاثةُ معاً: «جاهز» بالنموذج الافتراضي", ready.text.state === "ready" && ready.text.model === DEFAULT_MODEL && !ready.text.simulated);
  const preview = aiStatus({ MARKETING_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_KEY, MARKETING_AI_ENABLED: "1", VERCEL: "1", VERCEL_ENV: "preview" });
  chk("ولا يعمل في نشرة معاينة ولو اكتملت الإعدادات", preview.text.state === "disabled" && preview.text.reason === "preview");
  chk("ولا مزوّدَ يُبنى لما ليس جاهزاً", textProvider({ ...dev, MARKETING_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_KEY }) === null);
  chk("مزوّدٌ مجهول: «غيرُ مهيّأ»", aiStatus({ ...dev, MARKETING_AI_PROVIDER: "openai" }).text.reason === "unknown_provider");
  const simLocal = aiStatus({ ...dev, MARKETING_AI_PROVIDER: "simulated" });
  chk("المحاكاةُ محلياً: جاهزةٌ ومعلَّمة", simLocal.text.state === "ready" && simLocal.text.simulated);
  chk("ولا محاكاةَ في الإنتاج", aiStatus({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", MARKETING_AI_PROVIDER: "simulated" }).text.state === "disabled");
  chk("ولا في بناءٍ محليٍّ للإنتاج", aiStatus({ NODE_ENV: "production", MARKETING_AI_PROVIDER: "simulated" }).text.state === "disabled");
  chk("توليدُ الصور «غيرُ مهيّأ» دائماً", ready.image.state === "not_configured");
  const sim = await simulatedProvider().generate(req);
  chk("ناتجُ المحاكاة معلَّمٌ في كل نسخة", sim.variants.length === 2 && sim.variants.every((v) => v.text.startsWith(SIMULATED_MARK) && v.rationale.startsWith(SIMULATED_MARK)));

  // ── ٢) مزوّدُ Claude بـ fetch مُحقَن
  const log: Sent[] = [];
  const ok = anthropicProvider({ apiKey: FAKE_KEY, fetch: fakeFetch(() => json(200, message()), log) });
  const res = await ok.generate(req);
  chk("نجاح: نسختان من الناتج المنظَّم", res.variants.length === 2 && res.variants[0].text === "نصٌّ أول" && res.model === DEFAULT_MODEL);
  chk("والاستهلاكُ محفوظ", res.usage?.inputTokens === 120 && res.usage?.outputTokens === 80);
  const sent = log[0];
  chk("الطلبُ إلى واجهة الرسائل", /\/v1\/messages(\?|$)/.test(sent.url), sent.url.replace(/\?.*/, ""));
  chk("بالنموذج الافتراضي", sent.body.model === DEFAULT_MODEL);
  chk("والبديلُ عند الرفض مفعّل", sent.body.fallbacks === "default" && String(sent.headers.get("anthropic-beta")).includes("server-side-fallback-2026-07-01"));
  const oc = sent.body.output_config as { effort?: string; format?: { type?: string } } | undefined;
  chk("وناتجٌ بمخطّط", oc?.format?.type === "json_schema" && oc?.effort === "medium");
  // المكتبةُ (1.x) ترسل `apiKey` في `Authorization: Bearer` لا `x-api-key` — موثَّقٌ في `ClientOptions.apiKey`
  chk("والمفتاحُ في الترويسة لا في الجسم", sent.headers.get("authorization") === `Bearer ${FAKE_KEY}` && !JSON.stringify(sent.body).includes(FAKE_KEY));
  chk("وإلى الخادم الرسمي ولو ضبطت البيئةُ عنواناً آخر", sent.url.startsWith("https://api.anthropic.com/"));
  const userText = JSON.stringify(sent.body.messages);
  chk("والطلبُ يحمل الموجز والمسودة والتعليمات", userText.includes("نلتقي ونفكّر ونصنع") && userText.includes("مسودة أولى") && userText.includes("أقصر وأوضح"));
  chk("ولا يحمل بريداً ولا معرّفات", !/@|cuid|memberId|userId/.test(userText));
  chk("وبلا إعادةٍ داخلية: طلبٌ واحد", log.length === 1);

  const once = async (reply: () => Response | Promise<Response>) => {
    const l: Sent[] = [];
    const k = await kindOf(anthropicProvider({ apiKey: FAKE_KEY, fetch: fakeFetch(reply, l) }).generate(req));
    return { k, calls: l.length };
  };
  const r429 = await once(() => apiError(429, "rate_limit_error"));
  chk("٤٢٩: «حدُّ طلبات» يُعاد — ولا تعيده المكتبة", r429.k === "rate_limited+retry" && r429.calls === 1, r429.k);
  const r500 = await once(() => apiError(500, "api_error"));
  chk("٥٠٠: «غيرُ متاح» يُعاد", r500.k === "unavailable+retry" && r500.calls === 1, r500.k);
  const r529 = await once(() => apiError(529, "overloaded_error"));
  chk("٥٢٩ (ازدحام): «غيرُ متاح» يُعاد", r529.k === "unavailable+retry", r529.k);
  chk("٤٠٠: «طلبٌ خاطئ» لا يُعاد", (await once(() => apiError(400, "invalid_request_error"))).k === "invalid_request");
  chk("٤٠١: «مفتاح» لا يُعاد", (await once(() => apiError(401, "authentication_error"))).k === "auth");
  chk("٤٠٣: «مفتاح» لا يُعاد", (await once(() => apiError(403, "permission_error"))).k === "auth");
  const refusal = await once(() => json(200, message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }, "")));
  chk("رفضُ النموذج (بعد البديل): «مرفوض» لا يُعاد", refusal.k === "refused", refusal.k);
  const refusalPartial = await once(() => json(200, message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }, '{"variants":[{"te')));
  chk("والرفضُ بنصٍّ مقطوعٍ «مرفوض» لا «تالف»", refusalPartial.k === "refused", refusalPartial.k);
  const cut = await once(() => json(200, message({ stop_reason: "max_tokens" }, '{"variants":[{"text":"نصٌّ مقصو')));
  chk("ناتجٌ مقصوص: «ناتجٌ غيرُ صالح»", cut.k === "bad_output", cut.k);
  const badShape = await once(() => json(200, message({}, JSON.stringify({ wrong: true }))));
  chk("ناتجٌ لا يطابق المخطّط: «ناتجٌ غيرُ صالح»", badShape.k === "bad_output", badShape.k);
  const empty = await once(() => json(200, message({}, JSON.stringify({ variants: [{ text: "  ", rationale: "" }] }))));
  chk("نسخٌ فارغة: «ناتجٌ غيرُ صالح»", empty.k === "bad_output", empty.k);
  const down = await once(() => Promise.reject(new TypeError("fetch failed")));
  chk("انقطاعُ الاتصال: «غيرُ متاح» يُعاد", down.k === "unavailable+retry", down.k);

  // الإلغاءُ من الطابور (انقضاءُ المهلة): لا ينتظر الخادم
  const ctrl = new AbortController();
  const hanging = anthropicProvider({
    apiKey: FAKE_KEY,
    fetch: ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
  });
  const t0 = Date.now();
  const pending = kindOf(hanging.generate(req, ctrl.signal));
  setTimeout(() => ctrl.abort(), 50);
  const aborted = await pending;
  chk("الإلغاءُ يقطع الطلب فوراً: «مهلة» تُعاد", aborted === "timeout+retry" && Date.now() - t0 < 2000, `${aborted} ${Date.now() - t0}ms`);

  console.log(checks.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed ? `\nFAILED (${failed})` : `\nALL PASS (${checks.length})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
