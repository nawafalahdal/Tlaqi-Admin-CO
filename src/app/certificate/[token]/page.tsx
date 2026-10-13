import { notFound } from "next/navigation";
import {
  certificateFor,
  certificateBody,
  certificateHeading,
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
  const verified = verifyCertificateToken(decodeURIComponent(token));
  if (!verified) notFound();

  const data = await certificateFor(verified.memberId, verified.kind);
  if (!data) notFound();

  const c = certificatePalette(data.colorHex);
  const heading = certificateHeading(data.kind);

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

          {/* رمز الهوية أعلى الصفحة — الرمز الرسمي نفسه لا رسماً يشبهه */}
          <div className="relative flex justify-start">
            <SymbolMark color={c.ink} size="5.6cqw" />
          </div>

          <header className="relative text-center" style={{ marginTop: "-2.6cqw" }}>
            <h1
              className="font-extrabold"
              style={{ color: c.ink, fontSize: "5.3cqw", lineHeight: 1.25, letterSpacing: "0.05em" }}
            >
              {heading.ar}
            </h1>
            <p
              dir="ltr"
              className="font-semibold"
              style={{ color: c.ink, fontSize: "2.05cqw", letterSpacing: "0.07em", marginTop: "0.3cqw" }}
            >
              {heading.en}
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
                {/* التوقيع المعتمَد فوق السطر. ومن لا توقيع معتمَد له
                    يبقى سطرُه فارغاً واسمُه تحته: نسبةٌ لا انتحال —
                    ولا يُستعار توقيعُ من سبقه في المنصب. */}
                <div
                  className="mx-auto flex items-end justify-center"
                  style={{ height: "4.6cqw", marginBottom: "0.3cqw" }}
                >
                  {s.signatureImage && (
                    // التوقيع يُقنَّع ويُملأ بحبر الشهادة لا يُعرَض بحبره:
                    // الشهادة أربع خلفيات، وحبرُ التوقيع الأصلي يصحّ على
                    // بعضها ويختفي على بعض. وهو مُوحَّدٌ عند الاستلام إلى
                    // PNG شفّافٍ معتم الحبر، فالقناع يُلوّنه بما يُقرأ.
                    <span
                      aria-hidden="true"
                      style={{
                        display: "block",
                        width: "62%",
                        height: "4.6cqw",
                        background: c.ink,
                        maskImage: `url(${s.signatureImage})`,
                        WebkitMaskImage: `url(${s.signatureImage})`,
                        maskSize: "contain",
                        WebkitMaskSize: "contain",
                        maskRepeat: "no-repeat",
                        WebkitMaskRepeat: "no-repeat",
                        maskPosition: "center bottom",
                        WebkitMaskPosition: "center bottom",
                      }}
                    />
                  )}
                </div>
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

/** نسب الرمز الرسمي كما هي في ملف الهوية: 512 × 725 */
const MARK_RATIO = 725 / 512;
const MARK_SRC = "/brand/symbol-mark.png";

/** رمز تَـــلاقِ الرسمي — الأصل نفسه، لا رسمٌ يحاكيه.
 *
 *  والأصل صورةٌ بيضاء على شفافية، والشهادة أربع خلفيات مختلفة الفاتح
 *  منها والداكن. فيُقنَّع الرمز بـ`mask` ويُملأ بلون الحبر: اللون وحده
 *  يتبدّل، وهندسة الرمز تبقى بكسلاً ببكسل كما وردت — فلا يُعاد رسمها
 *  ولا تُقارَب بـCSS ولا تُستبدل بشكلٍ شبيه. */
function SymbolMark({
  color,
  size,
  opacity = 0.95,
}: {
  color: string;
  /** العرض بوحدة الحاوية — والارتفاع يتبعه بنسبة الأصل */
  size: string;
  opacity?: number;
}) {
  const mask = {
    maskImage: `url(${MARK_SRC})`,
    WebkitMaskImage: `url(${MARK_SRC})`,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  } as const;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: size,
        height: `calc(${size} * ${MARK_RATIO})`,
        background: color,
        opacity,
        ...mask,
      }}
    />
  );
}

/** الرمز الرسمي مكبَّراً وباهتاً خلف النصّ — زخرفةٌ من الهوية نفسها.
 *
 *  كانت أشكالاً رسمتُها تشبه الرمز، وشبهُ الرمز ليس الرمز. فصار نفسه،
 *  يفيض عن حدّ الورقة فلا يُقرأ رمزاً ثانياً ولا يزاحم الذي في الأعلى. */
function OrganicMarks({ color }: { color: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* على الحدّ المقابل للرمز الصغير: الصغير في مبدأ القراءة (يميناً)،
          والزخرفة في آخرها (يساراً) — فلا يقع أحدهما فوق الآخر */}
      <span
        className="absolute"
        style={{ top: "50%", left: "-15cqw", transform: "translateY(-50%)", display: "block" }}
      >
        <SymbolMark color={color} size="38cqw" opacity={1} />
      </span>
    </div>
  );
}
