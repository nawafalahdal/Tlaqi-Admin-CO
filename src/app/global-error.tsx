"use client";

/** حدّ الأخطاء العام.
 *
 *  بدونه يرى المستخدم شاشة المتصفح البيضاء "This page couldn't load" بلا
 *  سبب ولا مخرج. وأشيع سبب لها في منصة تُنشر كثيراً هو أن الصفحة بقيت
 *  مفتوحة من بناء سابق: معرّفات إجراءات الخادم تتغيّر مع كل بناء، فإرسال
 *  صفحة قديمة يقصد إجراءً لم يعد موجوداً. علاجه تحديث الصفحة — ولا سبيل
 *  لمعرفة ذلك ما لم يُقل. */
/** نصوصُها هنا لا في القاموس: هذا الحدُّ يحلّ محلّ التخطيط الجذري نفسه،
 *  فلا مُزوِّدَ لغةٍ فوقه — واللغةُ تُقرأ من كعكتها مباشرةً. */
const TEXT = {
  ar: {
    staleTitle: "صدر تحديث للمنصة أثناء فتحك الصفحة",
    title: "تعذّر إتمام العملية",
    staleBody: "صفحتك كانت مفتوحة من نسخة سابقة، فلم يصل طلبك. حدّث الصفحة وأعد المحاولة — لم يُحفظ شيء ولم يضع شيء.",
    body: "حدث خطأ غير متوقّع ولم يكتمل الإجراء. حدّث الصفحة وأعد المحاولة.",
    reload: "تحديث الصفحة",
    retry: "المحاولة دون تحديث",
  },
  en: {
    staleTitle: "The platform was updated while your page was open",
    title: "The action could not be completed",
    staleBody: "Your page was open from a previous version, so your request did not arrive. Refresh the page and try again — nothing was saved and nothing was lost.",
    body: "An unexpected error occurred and the action was not completed. Refresh the page and try again.",
    reload: "Refresh the page",
    retry: "Try again without refreshing",
  },
} as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleBuild =
    error.message?.includes("Failed to find Server Action") ||
    error.message?.includes("Server Action");

  const lang = typeof document !== "undefined" && /(?:^|;\s*)locale=en(?:;|$)/.test(document.cookie) ? "en" : "ar";
  const t = TEXT[lang];

  return (
    <html dir={lang === "en" ? "ltr" : "rtl"} lang={lang}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FAF8F4",
          fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: "100%",
            background: "#fff",
            borderRadius: 24,
            padding: 28,
            textAlign: "center",
            boxShadow: "0 10px 40px rgba(0,0,0,0.07)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#341D2B",
              margin: "0 auto 18px",
            }}
          />
          <h1 style={{ fontSize: 18, margin: "0 0 10px", color: "#1A1023" }}>
            {staleBuild ? t.staleTitle : t.title}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.9, color: "rgba(0,0,0,0.55)", margin: "0 0 20px" }}>
            {staleBuild ? t.staleBody : t.body}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              minHeight: 46,
              padding: "0 24px",
              borderRadius: 12,
              border: "none",
              background: "#C34900",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {t.reload}
          </button>
          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => reset()}
              style={{
                background: "none",
                border: "none",
                color: "rgba(0,0,0,0.45)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t.retry}
            </button>
          </div>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 11, color: "rgba(0,0,0,0.3)" }} dir="ltr">
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
