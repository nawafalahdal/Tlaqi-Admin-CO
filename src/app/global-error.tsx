"use client";

/** حدّ الأخطاء العام.
 *
 *  بدونه يرى المستخدم شاشة المتصفح البيضاء "This page couldn't load" بلا
 *  سبب ولا مخرج. وأشيع سبب لها في منصة تُنشر كثيراً هو أن الصفحة بقيت
 *  مفتوحة من بناء سابق: معرّفات إجراءات الخادم تتغيّر مع كل بناء، فإرسال
 *  صفحة قديمة يقصد إجراءً لم يعد موجوداً. علاجه تحديث الصفحة — ولا سبيل
 *  لمعرفة ذلك ما لم يُقل. */
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

  return (
    <html dir="rtl" lang="ar">
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
            {staleBuild ? "صدر تحديث للمنصة أثناء فتحك الصفحة" : "تعذّر إتمام العملية"}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.9, color: "rgba(0,0,0,0.55)", margin: "0 0 20px" }}>
            {staleBuild
              ? "صفحتك كانت مفتوحة من نسخة سابقة، فلم يصل طلبك. حدّث الصفحة وأعد المحاولة — لم يُحفظ شيء ولم يضع شيء."
              : "حدث خطأ غير متوقّع ولم يكتمل الإجراء. حدّث الصفحة وأعد المحاولة."}
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
            تحديث الصفحة
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
              المحاولة دون تحديث
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
