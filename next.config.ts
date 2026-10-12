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
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
