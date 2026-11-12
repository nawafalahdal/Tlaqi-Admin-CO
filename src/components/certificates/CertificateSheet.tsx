import { Fragment } from "react";
import { BRAND } from "@/lib/brand";
import { certificateFrame } from "@/lib/certificateStyle";
import { longDateAr, TYPE_INFO, type CertificateSignerView, type CertificateView } from "@/lib/certificateTypes";

/** **ورقةُ الشهادة** — القالبان المعتمدان في مكوّنٍ واحد يُرسم في الخادم والمتصفّح.
 *
 *  منه تُرسم الشهادةُ الصادرة (`/certificate/[token]`)، ومنه المعاينةُ الحيّة في
 *  «الترحيب والتكريم» — فما يُعاين هو ما يصدر. لا حالة فيه ولا خطّاف، ولا يقرأ
 *  قاعدة: يأخذ `CertificateView` جاهزةً ويرسمها.
 *
 *  - **الإطار الكلاسيكي**: شكر وتقدير، إنجاز، قيادة، عضوية، شكر وخبرة.
 *  - **الترويسة التحريرية**: شهادة التعيين — شريطٌ داكن بالشعار ورقم القرار،
 *    وخطٌّ بلون Mahogany، ثم جدولُ التعيين.
 *
 *  ومقاساتُها كلّها بوحدة `cqw` (جزءٌ من مئة من عرض الورقة)، مكتوبةً ببكسل
 *  التصميم (١١٢٣ = ٢٩٧mm) — فتتقلّص معاً على كل عرض وتُطبع A4 كما صُمّمت.
 *  والحاويةُ تُعطيها `containerType: inline-size` ونسبةَ ١١٢٣ / ٧٩٤. */
export function CertificateSheet({ view, watermark }: { view: CertificateView; watermark?: string }) {
  return view.template === "editorial" ? (
    <Editorial view={view} watermark={watermark} />
  ) : (
    <Classic view={view} watermark={watermark} />
  );
}

/** الحاوية: ورقةٌ A4 عرضيّة تتقلّص بعرض ما حولها */
export function CertificateFrameBox({
  children,
  className = "",
  rounded = true,
}: {
  children: React.ReactNode;
  className?: string;
  rounded?: boolean;
}) {
  return (
    <div
      className={`w-full overflow-hidden ${rounded ? "rounded-[1.2cqw]" : ""} ${className}`}
      style={{ aspectRatio: "1123 / 794", containerType: "inline-size" }}
    >
      {children}
    </div>
  );
}

/** بكسل التصميم ← وحدة الحاوية */
const u = (px: number) => `${(px / 11.23).toFixed(3)}cqw`;
/** ملّيمتر الطباعة ← بكسل التصميم (٢٩٧mm = ١١٢٣) */
const mm = (n: number) => u(n * (1123 / 297));
/** النقطة الطباعية ← بكسل التصميم */
const pt = (n: number) => u(n * (4 / 3));

const MAHOGANY = BRAND.mahogany;
const TEMPTRESS = BRAND.temptress;

/** «تتقدّم {TLAQI} …» — الاسمُ بحروفه اللاتينية في سطرٍ عربي */
function Intro({ text }: { text: string }) {
  const parts = text.split("{TLAQI}");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <Tlaqi />}
          {p}
        </Fragment>
      ))}
    </>
  );
}

function Watermark({ text }: { text: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center font-bold"
      style={{ fontSize: pt(64), color: "rgba(195,73,0,0.10)", transform: "rotate(-18deg)", zIndex: 4 }}
    >
      {text}
    </div>
  );
}

/** **الإطار الكلاسيكي** — ورقٌ فاتح بإطارٍ مزدوج بلون القسم، والشعارُ المعتمد في أعلاها،
 *  والاسمُ بطلُ الورقة، ثم بياناتُها في سطرٍ واحد، ثم موقِّعان بينهما ختمٌ بلون القسم. */
function Classic({ view, watermark }: { view: CertificateView; watermark?: string }) {
  const f = certificateFrame(view.colorHex);
  const hair = "rgba(52,29,43,0.22)";
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
      {watermark && <Watermark text={watermark} />}

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
            {view.heading.ar}
          </p>
          <p dir="ltr" style={{ fontSize: u(10), letterSpacing: "0.32em", opacity: 0.55, marginTop: u(1.5) }}>
            {view.heading.en.toUpperCase()}
          </p>
          <p style={{ fontSize: u(15.3), opacity: 0.8, marginTop: u(18.9) }}>
            <Intro text={view.intro} />
          </p>
          <h1 className="font-extrabold" style={{ fontSize: u(56), lineHeight: 1.25, marginTop: u(3.8) }}>
            {view.fullName || "—"}
          </h1>
          {view.personLine && (
            <p className="font-bold" style={{ fontSize: u(16), opacity: 0.85 }}>
              {view.personLine}
            </p>
          )}
          <p
            style={{
              fontSize: u(14.67),
              lineHeight: 1.9,
              opacity: 0.85,
              maxWidth: u(718),
              marginTop: u(9.45),
              whiteSpace: "pre-line",
            }}
          >
            {view.body}
          </p>
          <div className="flex" style={{ marginTop: u(17), fontSize: u(11.47) }}>
            {view.facts.map(([k, v], i) => (
              <div
                key={k}
                style={{ padding: `0 ${u(22.7)}`, borderInlineStart: i ? `${u(1.13)} solid rgba(52,29,43,0.2)` : undefined }}
              >
                <span className="block" style={{ fontSize: u(9.33), opacity: 0.55 }}>
                  {k}
                </span>
                {k === "رقم الشهادة" ? <Num>{v}</Num> : v}
              </div>
            ))}
          </div>
        </div>

        <footer className="flex w-full items-end justify-between">
          <Signer s={view.signers[0]} ink={f.signatureInk} />
          <div>
            <div
              className="mx-auto flex items-center justify-center rounded-full"
              style={{
                width: u(98.3),
                height: u(98.3),
                background: f.frame,
                boxShadow: `0 0 0 ${u(4.5)} ${f.paper}, 0 0 0 ${u(5.67)} ${f.frame}`,
              }}
            >
              <SymbolMark color={f.sealInk} size={u(41.6)} />
            </div>
            <p style={{ fontSize: u(10), opacity: 0.6, marginTop: u(9.45) }}>صدرت في {longDateAr(view.issuedAt)}</p>
          </div>
          {/* موقِّعٌ ثانٍ — أو فراغٌ بعرضه حين يوقّعها المؤسسُ وحده، فيبقى الختمُ في الوسط */}
          {view.signers[1] ? <Signer s={view.signers[1]} ink={f.signatureInk} /> : <div style={{ width: u(234.4) }} aria-hidden />}
        </footer>
      </div>
    </div>
  );
}

/** **الترويسة التحريرية** — شهادة التعيين: شريطٌ داكن بالشعار المعتمد (نسخة الخلفية
 *  الداكنة) ورقم القرار، وخطٌّ بلون Mahogany، ثم العنوانُ والاسمُ والصفةُ وجدولُ التعيين. */
function Editorial({ view, watermark }: { view: CertificateView; watermark?: string }) {
  const f = certificateFrame(view.colorHex);
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ background: f.paper, color: TEMPTRESS, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      {watermark && <Watermark text={watermark} />}
      <div
        className="relative flex items-center justify-between overflow-hidden"
        style={{ height: mm(46), background: TEMPTRESS, color: BRAND.beige, padding: `0 ${mm(20)}` }}
      >
        <span className="absolute" style={{ left: mm(30), top: mm(-22) }}>
          <SymbolMark color={BRAND.beige} size={mm(70)} opacity={0.06} />
        </span>
        {/* الشعار المعتمد كما هو — نسخة الخلفية الداكنة */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-fullname-on-dark.png"
          alt="TLAQI — Talent Link Advancing Quality Innovation"
          className="relative"
          style={{ height: u(120.7), width: "auto" }}
        />
        <div className="relative" style={{ textAlign: "left" }}>
          <b className="block" dir="ltr" style={{ fontSize: pt(8), letterSpacing: "0.3em", opacity: 0.65, fontWeight: 400 }}>
            APPOINTMENT
          </b>
          <span className="font-bold" style={{ fontSize: pt(11) }}>
            قرار تعيين
          </span>
          {view.number && (
            <span className="block" style={{ fontSize: pt(9), opacity: 0.75 }}>
              <Num>{view.number}</Num>
            </span>
          )}
        </div>
      </div>
      <div style={{ height: mm(2), background: MAHOGANY }} />

      <div className="flex flex-1 flex-col" style={{ padding: `${mm(11)} ${mm(20)}` }}>
        <div className="flex flex-1 flex-col justify-center">
          <p className="font-bold" style={{ fontSize: pt(24), lineHeight: 1.2 }}>
            {view.heading.ar}
          </p>
          <p dir="ltr" style={{ textAlign: "right", fontSize: pt(7.5), letterSpacing: "0.32em", opacity: 0.5, marginTop: mm(0.5) }}>
            {view.heading.en.toUpperCase()}
          </p>
          <p style={{ fontSize: pt(11), opacity: 0.75, marginTop: mm(5) }}>
            <Intro text={view.intro} />
          </p>
          <h1 className="font-bold" style={{ fontSize: pt(36), lineHeight: 1.2, marginTop: mm(0.5) }}>
            {view.fullName || "—"}
          </h1>
          {view.role && (
            <p className="font-bold" style={{ fontSize: pt(17), color: MAHOGANY, marginTop: mm(1) }}>
              {view.role}
            </p>
          )}
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${view.facts.length}, 1fr)`, marginTop: mm(6), borderTop: `${mm(0.4)} solid ${TEMPTRESS}` }}
          >
            {view.facts.map(([k, v]) => (
              <div key={k} className="font-bold" style={{ paddingTop: mm(2.4), fontSize: pt(10) }}>
                <b className="block" style={{ fontSize: pt(7.4), fontWeight: 400, opacity: 0.55 }}>
                  {k}
                </b>
                {v}
              </div>
            ))}
          </div>
          <p style={{ fontSize: pt(10.6), lineHeight: 1.9, opacity: 0.8, marginTop: mm(4), maxWidth: mm(200), whiteSpace: "pre-line" }}>
            {view.body}
          </p>
        </div>
        <div className="flex items-end" style={{ gap: mm(14) }}>
          <Signer s={view.signers[0]} ink={f.signatureInk} />
          {view.signers[1] && <Signer s={view.signers[1]} ink={f.signatureInk} />}
          <p style={{ marginInlineStart: "auto", fontSize: pt(7.5), opacity: 0.6, textAlign: "left", lineHeight: 1.7 }}>
            صدرت في {longDateAr(view.issuedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** رقمٌ لاتينيّ في سطرٍ عربي — يُعزل اتجاهُه فلا تتقلّب أجزاؤه */
function Num({ children }: { children: React.ReactNode }) {
  return (
    <bdi dir="ltr" style={{ fontFeatureSettings: '"tnum"' }}>
      {children}
    </bdi>
  );
}

/** موقِّعٌ واحد: توقيعُه المعتمَد فوق السطر، وصفتُه واسمُه تحته.
 *
 *  ومن لا توقيع معتمَد له يبقى سطرُه فارغاً واسمُه تحته: نسبةٌ لا
 *  انتحال — ولا يُستعار توقيعُ من سبقه في المنصب. */
function Signer({ s, ink }: { s: CertificateSignerView; ink: string }) {
  return (
    <div style={{ width: u(234.4), textAlign: "center" }}>
      <div className="flex items-end justify-center" style={{ height: u(56.7) }}>
        {s.signatureImage && (
          // التوقيع يُقنَّع ويُملأ بحبر منطقته — لا بلون الشهادة العام
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

/** «TLAQI» في سطر الشهادة — يُقرَّب T وL بمقدارٍ صغير ثابت (خطُّ Cairo يُبقي بينهما فراغاً) */
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

/** رمز TLAQI الرسمي — الأصل نفسه مُقنَّعاً بلون الحبر، لا رسمٌ يحاكيه */
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

/** عنوانُ النوع — يُستعمل في السجل والواجهة */
export function typeChip(type: CertificateView["type"]): string {
  return TYPE_INFO[type].chip;
}
