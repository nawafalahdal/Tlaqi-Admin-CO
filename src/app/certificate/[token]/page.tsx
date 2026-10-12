import { notFound } from "next/navigation";
import {
  certificateFor,
  certificateBody,
  certificatePalette,
  verifyCertificateToken,
} from "@/lib/certificate";
import { formatDate } from "@/lib/format";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** شهادة الشكر والتقدير — صفحة تُطبع.
 *
 *  صفحةٌ لا صورة: تُفتح بلا تسجيل دخول (صاحبها خرج من الفريق وحسابه
 *  مُعطَّل)، وتُطبع PDF بضغطة من المتصفّح، وتبقى نصّاً يُقرأ ويُكبَّر
 *  ويُنسخ. وتوليدها صورةً على الخادم يحتاج متصفّحاً كاملاً داخل دالة
 *  بلا حالة — ثمنٌ باهظ لما يفعله متصفّح القارئ مجاناً.
 *
 *  **ومقاساتها كلها بوحدة `cqw`** — جزءٌ من ألف من عرض الورقة. الشهادة
 *  لوحةٌ ثابتة النِسَب لا صفحةُ موقع تتمدّد: فإن قيس نصّها بالبكسل
 *  وحشوُها بالنسبة المئوية، اختلّ التناسب على كل عرضٍ غير الذي صُمِّمت
 *  عليه وفاض النصّ خارجها. أما `cqw` فتجعل كل شيء يتقلّص معاً.
 *
 *  والرابط موقَّع، فلا تُقرأ شهادة أحدٍ بتخمين معرّفه.
 */
export default async function CertificatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const memberId = verifyCertificateToken(decodeURIComponent(token));
  if (!memberId) notFound();

  const data = await certificateFor(memberId);
  if (!data) notFound();

  const c = certificatePalette(data.colorHex);

  return (
    <main className="min-h-screen bg-[#1A1023] p-4 print:bg-white print:p-0">
      <PrintButton />

      <div
        className="mx-auto w-full max-w-[1123px] overflow-hidden print:max-w-none"
        style={{
          background: c.background,
          aspectRatio: "1123 / 794",
          containerType: "inline-size",
        }}
      >
        <div className="relative flex h-full flex-col" style={{ padding: "4.2cqw 6cqw 2.4cqw" }}>
          <OrganicMarks color={c.ornament} />

          {/* رمز الهوية أعلى الصفحة.
              مرسومٌ هنا لا مستورَداً صورةً: الصورة درعٌ برتقالي بثقوب،
              فإن قُنّعت بشفافيتها خرجت كتلةً صمّاء. والرسم يأخذ لون
              الحبر نفسه فيصحّ على الخلفيات الأربع كلها. */}
          <div className="relative flex justify-start">
            <SymbolMark color={c.ink} />
          </div>

          <header className="relative text-center" style={{ marginTop: "-2.6cqw" }}>
            <h1
              className="font-extrabold"
              style={{ color: c.ink, fontSize: "5.3cqw", lineHeight: 1.25, letterSpacing: "0.05em" }}
            >
              شكــر وتقديــر
            </h1>
            <p
              dir="ltr"
              className="font-semibold"
              style={{ color: c.ink, fontSize: "2.05cqw", letterSpacing: "0.07em", marginTop: "0.3cqw" }}
            >
              Certification of Appreciation
            </p>
            <div
              className="mx-auto flex items-center"
              style={{ maxWidth: "58%", gap: "1.2cqw", marginTop: "1.4cqw" }}
            >
              <span className="h-px flex-1" style={{ background: c.rule }} />
              <span style={{ color: c.rule, fontSize: "1.3cqw", letterSpacing: "0.3em" }}>◈◈</span>
              <span className="h-px flex-1" style={{ background: c.rule }} />
            </div>
          </header>

          <section className="relative flex flex-1 items-center justify-center">
            <p
              className="text-center font-bold"
              style={{ color: c.ink, fontSize: "2.25cqw", lineHeight: 2.05, maxWidth: "88%" }}
            >
              {certificateBody(data)}
            </p>
          </section>

          {/* التوقيعان: من يمثّل جهته، ومن يمثّل المنصة */}
          <footer className="relative grid grid-cols-2" style={{ gap: "9cqw" }}>
            {data.signers.map((s, i) => (
              <div key={i} className="text-center">
                <span
                  className="mx-auto block"
                  style={{ height: "1px", width: "74%", background: c.rule, marginBottom: "1cqw" }}
                />
                <p className="font-bold" style={{ color: c.ink, fontSize: "1.5cqw" }}>
                  {s.title}
                </p>
                <p style={{ color: c.muted, fontSize: "1.42cqw", marginTop: "0.15cqw" }}>{s.name}</p>
              </div>
            ))}
          </footer>

          <p
            className="relative text-center"
            style={{ color: c.muted, fontSize: "1.05cqw", marginTop: "1.6cqw" }}
          >
            صدرت بتاريخ {formatDate(new Date())} · تَـــلاقِ — نلتقي · نفكّر · نصنع
          </p>
        </div>
      </div>

      {/* الشريط السفلي بألوان الهوية الأربعة */}
      <div className="mx-auto flex h-2 w-full max-w-[1123px] print:max-w-none">
        <span className="flex-1" style={{ background: "#EEF6DF" }} />
        <span className="flex-1" style={{ background: "#C34900" }} />
        <span className="flex-1" style={{ background: "#341D2B" }} />
        <span className="flex-1" style={{ background: "#67C090" }} />
      </div>
    </main>
  );
}

/** رمز تَـــلاقِ: نقاطٌ تتشعّب من مركز — لقاءٌ وتفرّع */
function SymbolMark({ color }: { color: string }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      style={{ width: "5.6cqw", height: "5.6cqw", opacity: 0.95 }}
      fill={color}
    >
      {rays.map((a) => (
        <g key={a} transform={`rotate(${a} 50 50)`}>
          <rect x="47.4" y="22" width="5.2" height="22" rx="2.6" />
          <circle cx="50" cy="18" r="7" />
        </g>
      ))}
      <circle cx="50" cy="50" r="6.5" />
    </svg>
  );
}

/** أشكال عضوية مستوحاة من رمز الهوية — خلفية لا عنصر يُقرأ */
function OrganicMarks({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1123 794"
      fill={color}
      preserveAspectRatio="none"
    >
      <circle cx="52" cy="92" r="58" />
      <rect x="74" y="128" width="34" height="96" rx="17" />
      <circle cx="128" cy="258" r="92" />
      <rect x="104" y="332" width="36" height="92" rx="18" />
      <circle cx="58" cy="436" r="74" />
      <rect x="70" y="500" width="32" height="86" rx="16" />
      <circle cx="86" cy="628" r="62" />
    </svg>
  );
}
