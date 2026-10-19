/** نتيجةُ محاولةِ إرسالٍ واحدة — مُصنَّفةً لا مجموعةً في «تعذّر».
 *
 *  ## العطبُ الذي يُصلحه هذا الملفّ
 *
 *  **الحادثة:** انضمّ عضوٌ فلم تصله بطاقةُ الانضمام. وضغط المسؤولُ زرَّ
 *  الإرسال فظهر له: «تعذّر إرسال البريد الآن». ولم يَعرف أحدٌ — لا هو
 *  ولا أنا — ماذا حدث.
 *
 *  **والسبب:** طبقةُ البريد كانت تُفرّق بين خمس حالاتٍ في داخلها (لا
 *  مستلِم، وبريدٌ معطّل، وكَتمٌ بالسياسة، ورفضُ المزوّد، وانقطاعُ شبكة)
 *  ثم تُعيدها كلَّها `{ skipped: true }`. فصارت خمسةُ أسبابٍ مختلفة —
 *  بعضُها يُصلَح بدقيقة وبعضُها يَحتاج توثيقَ نطاق — تُقرأ جملةً واحدةً
 *  لا تدلّ على شيء.
 *
 *  **والحلُّ ليس تحسينَ نصّ الرسالة.** الحلُّ أن تُعيد الطبقةُ ما تَعرفه
 *  فعلاً: الحالةَ باسمها، ومعها جوابُ المزوّد إن رفض. فمن يَقرأ يَعرف
 *  أيُّها عنده وأيُّها عند جوجل.
 *
 *  ## وما لا يُدَّعى
 *
 *  **القبولُ ليس وصولاً.** واجهةُ Resend تُعيد «قُبِلت ومعها معرّف» —
 *  وهذا أقصى ما يُعلَم لحظةَ الإرسال. أمّا الوصولُ والارتدادُ فلا
 *  يُعرَفان إلا من أحداث المزوّد (webhooks)، ولا تَصلها المنصةُ اليوم.
 *  فلا يُقال «وصلت» حيث لا دليل: يُقال «قُبِلت لدى المزوّد»، ويُحفَظ
 *  معرّفُها ليُراجَع به عند المزوّد نفسِه.
 */

export type SendOutcome =
  /** قَبِلها المزوّدُ وأعطى معرّفاً — وهذا أقصى ما يُعلَم الآن */
  | { state: "accepted"; providerId: string | null }
  /** لا مستلِمَ أصلاً — بريدٌ فارغٌ أو قائمةٌ خاوية */
  | { state: "no_recipient" }
  /** كُتمت بسياسة التقليل — بقرارٍ منّا لا بعطب */
  | { state: "suppressed_policy"; why: string }
  /** مستلِمُها أُغلقت تجربتُه — وعدٌ بألّا نراسله بعد الوداع */
  | { state: "suppressed_closed" }
  /** لا مفتاحَ للمزوّد في هذه البيئة */
  | { state: "provider_disabled" }
  /** وصل المزوّدَ فرفضه — ومعه سببُه بنصّه */
  | { state: "provider_rejected"; name: string; message: string }
  /** لم يصل المزوّدَ أصلاً: شبكةٌ أو مهلة */
  | { state: "transport_failed"; message: string };

/** نتيجةٌ تُعاد إلى كل نداءٍ قديم كما كان، ومعها التصنيف.
 *
 *  و`skipped` يبقى كما كان عمداً: اثنان وثلاثون موضعاً تَقرؤه، وتغييرُها
 *  كلِّها في خطوةٍ واحدة مجازفةٌ بلا مقابل. فالحقلُ القديم يُشتَقّ من
 *  الجديد، والجديدُ يُقرأ حيث يَلزم. */
export type SendResult = {
  skipped: boolean;
  error?: boolean;
  outcome: SendOutcome;
};

export function resultOf(outcome: SendOutcome): SendResult {
  return {
    skipped: outcome.state !== "accepted",
    error: outcome.state === "provider_rejected" || outcome.state === "transport_failed",
    outcome,
  };
}

/** حالةُ السجلّ المقابلةُ للنتيجة — ما يُكتَب في عمود «الحالة» */
export function logStatusFor(outcome: SendOutcome) {
  switch (outcome.state) {
    case "accepted":
      return "أُرسلت" as const;
    case "provider_disabled":
      return "لم تُرسل (البريد معطّل)" as const;
    case "suppressed_policy":
      return "لم تُرسل (سياسة التقليل)" as const;
    default:
      return "فشل الإرسال" as const;
  }
}

/** جملةٌ يَقرؤها المسؤولُ فيَعرف ماذا يفعل — لا «تعذّر».
 *
 *  وكلُّ جملةٍ تَحمل **الفعلَ التالي**: من رأى «رفض المزوّد» يَفتح لوحةَ
 *  المزوّد، ومن رأى «لا مفتاح» يُضيف المفتاح، ومن رأى «أُغلقت تجربته»
 *  يَعرف أنه ليس عطباً بل عهدٌ يُحفَظ.
 */
export function reasonFor(outcome: SendOutcome): string {
  switch (outcome.state) {
    case "accepted":
      return "قَبِلها مزوّدُ البريد";
    case "no_recipient":
      return "لا بريدَ مسجَّلٌ لهذا الشخص — أضِف بريده ثم أعِد المحاولة";
    case "suppressed_closed":
      return "أُغلقت تجربةُ صاحب هذا البريد، ولا تُراسَل بعد الوداع";
    case "suppressed_policy":
      return `كُتمت بسياسة تقليل الرسائل — ${outcome.why}`;
    case "provider_disabled":
      return "مفتاحُ مزوّد البريد غيرُ مضبوطٍ في هذه البيئة، فلا تُرسَل رسالة";
    case "provider_rejected":
      // نصُّ المزوّد كما قاله: هو الوحيدُ الذي يُفيد — «النطاق غير
      // موثَّق» شيء، و«تجاوزتَ الحدّ» شيءٌ آخر، و«المستلِم مرفوض» ثالث
      return `رفضها مزوّدُ البريد — ${outcome.name}: ${outcome.message}`;
    case "transport_failed":
      return `لم تصل مزوّدَ البريد (انقطاعٌ أو مهلة) — ${outcome.message}`;
  }
}

/** أيُعاد المحاولةُ مجدية؟ — الشبكةُ تُعاد، والنطاقُ غيرُ الموثَّق لا.
 *
 *  فزرُّ «أعِد المحاولة» لا يُعرَض حيث لا تُجدي الإعادة: زرٌّ يُضغَط
 *  فيَفشل كما فشل وعدٌ كاذب. */
export function worthRetrying(outcome: SendOutcome): boolean {
  if (outcome.state === "transport_failed") return true;
  if (outcome.state === "provider_rejected") {
    // حدُّ الإرسال يَنقضي، والخطأُ الداخليُّ يَزول — أمّا الرفضُ على
    // النطاق أو المستلِم فلا تُغيّره إعادة
    return /rate|limit|timeout|temporar|internal|try again|503|429/i.test(
      `${outcome.name} ${outcome.message}`
    );
  }
  return false;
}
