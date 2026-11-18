import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  agentRules: false,

  /** ملفّان يُقرآن من القرص داخل دالّة بلا حالة، فلا يَستنتجهما التتبّع.
   *
   *  Next يحزم ما يراه في `import`. ومسار اللوحة الترحيبية يقرأ ملفّين
   *  بمسارٍ مبنيٍّ في وقت التنفيذ (`join(process.cwd(), …)`): اللوحة
   *  الرمادية الأصل، وخطّ Cairo الذي يرسم به librsvg اسم العضو. وكونُ
   *  اللوحة في `public/` يجعلها تُخدَم للمتصفّح، ولا يضعها في حزمة
   *  الدالّة.
   *
   *  وبدون هذا السطر يعمل كل شيء محلياً ويفشل في الإنتاج وحده: اللوحة
   *  تُرجِع ٥٠٠، أو — وهو أسوأ — يُرسَم اسم العضو مربّعاتٍ فارغة لأن لا
   *  خطّ عربي في بيئة التنفيذ. */
  outputFileTracingIncludes: {
    "/api/welcome-banner/[token]": ["./public/brand/banner/**", "./assets/fonts/**"],
    // صورتا المشاركة تقرآن الشعار من `public/brand` وترسمان النصّ بخطّ `assets/fonts` — للسبب نفسه
    "/api/cards/[type]/[token]": ["./public/brand/**", "./assets/fonts/**"],
    // علامةُ الشعار بلون القسم تُلوَّن من ملفّها الرسمي في `public/brand/2026/email`
    "/api/brand-mark/[hex]": ["./public/brand/2026/email/**"],
    // تنزيلُ الهيكل PDF: الهيئتان الافتراضيتان من `public/brand/2026/portraits`، والنصُّ بخطّ الهوية
    "/structure/download": ["./public/brand/2026/portraits/**", "./assets/fonts/**"],
    // **ترويسةُ البريد تُرسم بخطّ الهوية وقتَ الإرسال** (`emailHeader`) — والبريدُ يُرسَل من إجراءاتٍ وصفحاتٍ كثيرة، فيُحزم
    // الخطُّ العريض (وCairo للحروف اللاتينية) مع كل دالّة. بدونه يُرسم اسمُ الجهة في الإنتاج بلا خطٍّ عربي (مربّعات)
    "**": ["./assets/fonts/TheYearofTheCamel-Bold.otf", "./assets/fonts/Cairo-Bold.ttf"],
  },

  /** حدُّ حجم طلب Server Action — صورةُ وجهٍ من جوّالٍ حديث تتجاوز
   *  الافتراضي (١ ميجابايت) بسهولة.
   *
   *  **عطبٌ رآه المستخدم:** رفع صورته فظهرت «تعذّر إتمام العملية».
   *  والسبب أن الطلب نفسه رُفض قبل أن يصل إلى الإجراء، فلم يُنفَّذ
   *  `try/catch` فيه ولا عاد بخطأٍ مفهوم — سقط الطلب فظهر حاجزُ
   *  الأخطاء العام. ورفعُ الحدّ وحده لا يكفي: الواجهة تُصغّر الصورة
   *  قبل الإرسال أيضاً، وهذا الحدّ شبكةُ أمانٍ لا طريقٌ معتاد. */
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
