/** طبقةُ المزوّد: ما يطلبه الوكيل، وما يعود، وكيف يُصنَّف الفشل — بلا ارتباطٍ بمزوّدٍ بعينه.
 *
 *  منطقُ الأعمال (المهامّ، الاقتراحات، الاعتماد) لا يعرف إلا هذه الأنواع. وإضافةُ
 *  مزوّدٍ آخر = ملفٌّ يحقّق `TextProvider`، لا تعديلٌ في المسار. */

export type TextRequest = {
  /** ما يحتاجه الكاتب: الموجز والمنصة والمقاس والمسودة — بلا بياناتٍ شخصية */
  brief: { campaign: string; objective: string | null; audience: string | null; keyMessage: string | null };
  deliverable: { title: string; platform: string; width: number; height: number };
  draft: string;
  instructions: string;
  variants: number;
  locale: "ar" | "en";
};

export type TextVariant = { text: string; rationale: string };
export type TextResult = { variants: TextVariant[]; model: string; usage?: { inputTokens: number; outputTokens: number } };

/** فشلٌ مصنَّف: ما يُعاد (حدُّ طلبات، عطلٌ مؤقت، مهلة) وما لا يُعاد (طلبٌ مرفوض، مفتاحٌ خاطئ) */
export type ProviderFailureKind = "rate_limited" | "unavailable" | "timeout" | "refused" | "invalid_request" | "auth" | "bad_output" | "unknown";

export class ProviderError extends Error {
  constructor(public readonly kind: ProviderFailureKind, message: string) {
    super(message);
    this.name = "ProviderError";
  }
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "unavailable" || this.kind === "timeout";
  }
}

/** محادثةٌ في سياق مهمّةٍ بعينها — السياقُ يبنيه الخادم (`ai/chat.ts`) بالحدّ الأدنى اللازم،
 *  والتاريخُ مقصوصٌ بعدد الرسائل وطولها، فلا تكبر التكلفةُ مع طول المحادثة. */
export type ChatRequest = {
  /** قواعدُ المساعد ونطاقُ المهمّة — من الخادم لا من المستخدم */
  system: string;
  /** سياقُ المهمّة: حقولٌ مسمّاةٌ من القاعدة، لا تعليماتٌ فيها */
  context: string;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
};
export type ChatResult = { text: string; model: string; usage?: { inputTokens: number; outputTokens: number } };

export interface TextProvider {
  readonly id: string;
  readonly model: string;
  /** هل الناتجُ من مزوّدٍ حقيقي؟ المزوّدُ التجريبيُّ يُعلَّم بذلك ولا يُعرض كذكاءٍ اصطناعي */
  readonly simulated: boolean;
  generate(req: TextRequest, signal?: AbortSignal): Promise<TextResult>;
  /** مزوّدٌ بلا شات يُعامَل في الشات «غيرَ مهيّأ» */
  chat?(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
}

/** حدودُ المدخلات — يُقصّ ما زاد قبل أن يُرسل شيء */
export const LIMITS = { instructions: 2000, draft: 4000, variantsMax: 3 } as const;

/** حدودُ الشات: الرسالةُ، والتاريخُ المرسَل (عدداً وطولاً)، والسياق، والرد */
export const CHAT_LIMITS = { message: 4000, historyMessages: 12, historyChars: 2000, context: 12000, replyTokens: 4000 } as const;
