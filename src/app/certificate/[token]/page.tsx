import { notFound } from "next/navigation";
import {
  certificateFor,
  certificateBody,
  certificateHeading,
  certificateFrame,
  serviceDurationAr,
  verifyCertificateToken,
  type CertificateData,
  type CertificateSigner,
} from "@/lib/certificate";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** الشهادتان — صفحةٌ تُطبع، بالقالب المعتمد «الإطار الكلاسيكي».
 *
 *  **شهادة الشكر والخبرة** (ختام المسيرة) و**شهادة التقدير** (ثلاثة أشهر)
 *  بالقالب نفسه ولون القسم نفسه؛ يفرّق بينهما عنوانُهما ونصُّهما وبياناتُهما.
 *
 *  صفحةٌ لا صورة: تُفتح بلا تسجيل دخول (صاحبها قد خرج وحسابه مُعطَّل)،
 *  وتُطبع PDF بضغطة، وتبقى نصّاً يُقرأ ويُكبَّر.
 *
 *  **ومقاساتها كلّها بوحدة `cqw`** — جزءٌ من مئة من عرض الورقة. الشهادة
 *  لوحةٌ ثابتة النِسَب: لو قيس نصُّها بالبكسل اختلّ التناسب على كل عرضٍ
 *  غير الذي صُمِّمت عليه. والمقاسات أدناه مكتوبةٌ ببكسل التصميم (عرضه
 *  ١١٢٣) وتُحوَّل بـ`u()` — فتُقرأ كما صُمِّمت وتتقلّص معاً.
 *
 *  والرابط موقَّع، فلا تُقرأ شهادة أحدٍ بتخمين معرّفه. */
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

  return (
    <main className="min-h-screen bg-[#1A1023] p-4 print:bg-white print:p-0">
      {/* الورقة A4 عرضيّة بلا هوامش — مقاسُ القالب المعتمد. هنا لا في الأنماط العامة: يخصّ هذه الصفحة */}
      <style>{"@page { size: A4 landscape; margin: 0; }"}</style>
      <PrintButton />
      {/* الشهادةُ ورقةٌ A4 عرضيّة: على شاشة الجوّال تصغر كلُّها معاً، فيُدَلّ قارئُها على القراءة الواضحة */}
      <p className="mx-auto mb-3 max-w-[1123px] text-center text-xs leading-relaxed text-[#EEF6DF]/75 sm:hidden print:hidden">
        للقراءة على الجوّال: كبّر الصفحة بإصبعين، أو احفظها PDF من الزرّ أعلاه.
      </p>
      <div
        className="mx-auto w-full max-w-[1123px] overflow-hidden rounded-[1.2cqw] print:max-w-none print:rounded-none"
        style={{ aspectRatio: "1123 / 794", containerType: "inline-size" }}
      >
        <ClassicFrame data={data} />
      </div>
    </main>
  );
}

/** بكسل التصميم ← وحدة الحاوية */
const u = (px: number) => `${(px / 11.23).toFixed(3)}cqw`;

/** التاريخ كما يُقرأ على ورقة: «٢٠ أكتوبر ٢٠٢٦» */
function longDate(d: Date) {
  return new Intl.DateTimeFormat("ar-u-ca-gregory-nu-arab", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}


/** **الإطار الكلاسيكي** — القالب المعتمد لشهادتَي الشكر والخبرة وتقدير الثلاثة أشهر.
 *
 *  ورقٌ فاتح بإطارٍ مزدوج بلون القسم، والشعارُ المعتمد (TLAQI مع الاسم الكامل)
 *  في أعلاها، والاسمُ بطلُ الورقة، ثم بياناتُها في سطرٍ واحد، ثم موقِّعان بينهما
 *  ختمٌ بلون القسم. المقاساتُ ببكسل التصميم (١١٢٣ = ٢٩٧mm)، فالشعار بارتفاع
 *  ٢٦mm في الطباعة — أقلُّ ما يبقى معه الاسمُ الكامل فوق ٦pt. */
function ClassicFrame({ data }: { data: CertificateData }) {
  const f = certificateFrame(data.colorHex);
  const heading = certificateHeading(data.kind);
  const dept = data.departmentName?.trim();
  const hair = "rgba(52,29,43,0.22)";
  const meta: Array<[string, string]> =
    data.kind === "appreciation"
      ? [
          ["تاريخ الانضمام", longDate(data.period.start)],
          ["مدة المشاركة", serviceDurationAr(data.period.start, data.period.end)],
        ]
      : [
          ["الفترة", `${longDate(data.period.start)} — ${longDate(data.period.end)}`],
          ["مدة المشاركة", serviceDurationAr(data.period.start, data.period.end)],
        ];

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: f.paper, color: f.ink, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <div className="pointer-events-none absolute" style={{ inset: u(30.2), border: `${u(6.05)} solid ${f.frame}`, borderRadius: u(11.3) }} />
      <div className="pointer-events-none absolute" style={{ inset: u(43.5), border: `${u(1.13)} solid ${hair}`, borderRadius: u(6.05) }} />
      <span className="absolute" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
        <SymbolMark color={f.ink} size={u(453.7)} opacity={0.035} />
      </span>

      <div
        className="relative flex h-full flex-col items-center text-center"
        style={{ padding: `${u(56.7)} ${u(90.7)} ${u(49.2)}` }}
      >
        {/* الشعار المعتمد كما هو: TLAQI والاسم الكامل تحته — نسخة الخلفية الفاتحة */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-fullname-on-light.png"
          alt="TLAQI — Talent Link Advancing Quality Innovation"
          style={{ height: u(120.7), width: "auto" }}
        />

        <div className="flex flex-1 flex-col items-center justify-center">
          <p className="font-bold" style={{ fontSize: u(20), color: f.accent }}>
            {heading.ar}
          </p>
          <p dir="ltr" style={{ fontSize: u(10), letterSpacing: "0.32em", opacity: 0.55, marginTop: u(1.5) }}>
            {heading.en.toUpperCase()}
          </p>
          <p style={{ fontSize: u(15.3), opacity: 0.8, marginTop: u(18.9) }}>
            تتقدّم <Tlaqi /> {data.kind === "appreciation" ? "بخالص الشكر والتقدير إلى" : "بخالص الشكر والامتنان إلى"}
          </p>
          <h1 className="font-extrabold" style={{ fontSize: u(56), lineHeight: 1.25, marginTop: u(3.8) }}>
            {data.fullName}
          </h1>
          <p className="font-bold" style={{ fontSize: u(16), opacity: 0.85 }}>
            {data.personTitle}
            {dept ? ` — ${dept === "الإدارة العليا" ? dept : `قسم ${dept}`}` : ""}
          </p>
          <p style={{ fontSize: u(14.67), lineHeight: 1.9, opacity: 0.85, maxWidth: u(718), marginTop: u(9.45) }}>
            {certificateBody(data)}
          </p>
          <div className="flex" style={{ marginTop: u(17), fontSize: u(11.47) }}>
            {meta.map(([k, v], i) => (
              <div key={k} style={{ padding: `0 ${u(22.7)}`, borderInlineStart: i ? `${u(1.13)} solid rgba(52,29,43,0.2)` : undefined }}>
                <span className="block" style={{ fontSize: u(9.33), opacity: 0.55 }}>
                  {k}
                </span>
                {v}
              </div>
            ))}
          </div>
        </div>

        <footer className="flex w-full items-end justify-between">
          <Signer s={data.signers[0]} ink={f.signatureInk} />
          <div>
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: u(98.3),
                height: u(98.3),
                background: f.frame,
                boxShadow: `0 0 0 ${u(4.5)} ${f.paper}, 0 0 0 ${u(5.67)} ${f.frame}`,
              }}
            >
              <SymbolMark color={f.sealInk} size={u(41.6)} />
            </div>
            <p style={{ fontSize: u(10), opacity: 0.6, marginTop: u(9.45) }}>صدرت في {longDate(data.issuedAt)}</p>
          </div>
          <Signer s={data.signers[1]} ink={f.signatureInk} />
        </footer>
      </div>
    </div>
  );
}

/** موقِّعٌ واحد: توقيعُه المعتمَد فوق السطر، وصفتُه واسمُه تحته.
 *
 *  ومن لا توقيع معتمَد له يبقى سطرُه فارغاً واسمُه تحته: نسبةٌ لا
 *  انتحال — ولا يُستعار توقيعُ من سبقه في المنصب. */
function Signer({ s, ink }: { s: CertificateSigner; ink: string }) {
  return (
    <div style={{ width: u(234.4), textAlign: "center" }}>
      <div className="flex items-end justify-center" style={{ height: u(56.7) }}>
        {s.signatureImage && (
          // التوقيع يُقنَّع ويُملأ بحبر **منطقته**: يُختار من لونَي الهوية الأعلى
          // تبايناً مع خلفية المنطقة (`inkForBackground`) — لا بلون الشهادة العام
          <span
            aria-hidden="true"
            style={{
              display: "block",
              width: "80%",
              height: u(56.7),
              background: ink,
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
      <span className="block" style={{ height: u(1.13), background: "rgba(52,29,43,0.28)", margin: `${u(6)} 0 ${u(6.8)}` }} />
      <p className="font-bold" style={{ fontSize: u(13.33), lineHeight: 1.35 }}>
        {s.title}
      </p>
      <p style={{ fontSize: u(11.47), opacity: 0.7, marginTop: u(2) }}>{s.name}</p>
    </div>
  );
}

/** «TLAQI» في سطر الشهادة.
 *
 *  خطُّ المنصة (Cairo) يُبقي بين T وL فراغاً ظاهراً في المقاسات الصغيرة لا يقرّبه التقنين
 *  (`font-kerning`)، فيُقرأ «T LAQI». فيُقرَّب الحرفان بمقدارٍ صغير ثابت بالنسبة للخطّ —
 *  دون تغيير الخطّ ولا التباعد في باقي السطر. */
function Tlaqi() {
  return (
    <bdi dir="ltr">
      T<span style={{ marginInlineStart: "-0.08em" }}>LAQI</span>
    </bdi>
  );
}

/** نسب الرمز الرسمي كما هي في ملف الهوية: 512 × 725 */
const MARK_RATIO = 725 / 512;
const MARK_SRC = "/brand/symbol-mark.png";

/** رمز TLAQI الرسمي — الأصل نفسه، لا رسمٌ يحاكيه.
 *
 *  الأصل صورةٌ بيضاء على شفافية، فيُقنَّع ويُملأ بلون الحبر: اللون وحده
 *  يتبدّل، وهندسة الرمز تبقى كما وردت. */
function SymbolMark({ color, size, opacity = 0.95 }: { color: string; size: string; opacity?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: size,
        height: `calc(${size} * ${MARK_RATIO})`,
        background: color,
        opacity,
        maskImage: `url(${MARK_SRC})`,
        WebkitMaskImage: `url(${MARK_SRC})`,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
