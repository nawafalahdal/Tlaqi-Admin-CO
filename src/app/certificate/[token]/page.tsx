import { notFound } from "next/navigation";
import {
  certificateFor,
  certificateBody,
  certificateHeading,
  certificatePalette,
  verifyCertificateToken,
  type CertificateData,
  type CertificateSigner,
} from "@/lib/certificate";
import { BRAND, themeFromColor } from "@/lib/brand";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** الشهادتان — صفحةٌ تُطبع، بتصميمين معتمدين.
 *
 *  **شهادة الشكر والخبرة** (ختام المسيرة): لونُ القسم يملأ الورقة كلّها،
 *  والاسمُ في وسطها. **وشهادة التقدير** (ثلاثة أشهر): ورقٌ فاتح وشريطٌ
 *  جانبيٌّ بلون القسم — أخفّ، لأنها محطّةٌ في مسيرةٍ جارية لا ختامُها.
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
      <PrintButton />
      <div
        className="mx-auto w-full max-w-[1123px] overflow-hidden rounded-[1.2cqw] print:max-w-none print:rounded-none"
        style={{ aspectRatio: "1123 / 794", containerType: "inline-size" }}
      >
        {data.kind === "final" ? <FullColour data={data} /> : <PaperRibbon data={data} />}
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

function shortDate(d: Date) {
  return new Intl.DateTimeFormat("ar-u-ca-gregory-nu-arab", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** المفهوم «أ» — لون القسم كاملاً، والاسمُ أولاً. لختام المسيرة. */
function FullColour({ data }: { data: CertificateData }) {
  const c = certificatePalette(data.colorHex);
  const heading = certificateHeading(data.kind);
  const dept = data.departmentName?.trim();

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: c.background, color: c.ink }}>
      <span className="absolute" style={{ left: u(-230), top: "50%", transform: "translateY(-50%)" }}>
        <SymbolMark color={c.ink} size={u(620)} opacity={0.08} />
      </span>
      <div
        className="pointer-events-none absolute"
        style={{ inset: u(22), border: `1.5px solid ${c.rule}`, borderRadius: u(26) }}
      />

      <div className="relative flex h-full flex-col" style={{ padding: `${u(54)} ${u(80)} ${u(50)}` }}>
        <div className="flex items-center justify-between">
          <SymbolMark color={c.ink} size={u(46)} />
          {dept && (
            <span className="font-bold" style={{ fontSize: u(15), opacity: 0.78 }}>
              {dept}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center" style={{ marginTop: u(-20) }}>
          <p className="font-bold" style={{ fontSize: u(24), opacity: 0.9 }}>
            {heading.ar}
          </p>
          <p dir="ltr" style={{ fontSize: u(13), letterSpacing: "0.22em", opacity: 0.62, marginTop: u(6) }}>
            {heading.en.toUpperCase()}
          </p>
          <p style={{ fontSize: u(19), opacity: 0.85, marginTop: u(34) }}>
            تتقدّم تَـــلاقِ بخالص الشكر والامتنان إلى
          </p>
          <h1 className="font-extrabold" style={{ fontSize: u(76), lineHeight: 1.25, marginTop: u(4) }}>
            {data.fullName}
          </h1>
          <p className="font-bold" style={{ fontSize: u(20), opacity: 0.9, marginTop: u(10) }}>
            {data.personTitle}
            {dept ? ` — ${dept === "الإدارة العليا" ? dept : `قسم ${dept}`}` : ""}
          </p>
          <p style={{ fontSize: u(19), lineHeight: 1.95, opacity: 0.92, maxWidth: u(820), marginTop: u(8) }}>
            {certificateBody(data)}
          </p>
          <p style={{ fontSize: u(15), opacity: 0.72, marginTop: u(12) }}>
            من {longDate(data.period.start)} إلى {longDate(data.period.end)}
          </p>
        </div>

        <footer className="flex items-end justify-between">
          <Signer s={data.signers[0]} ink={c.ink} rule={c.rule} muted={c.muted} width={u(290)} />
          <p className="text-center" style={{ fontSize: u(12), lineHeight: 1.8, opacity: 0.65 }}>
            صدرت في {shortDate(new Date())}
            <br />
            صادرة من إدارة تَـــلاقِ
          </p>
          <Signer s={data.signers[1]} ink={c.ink} rule={c.rule} muted={c.muted} width={u(290)} />
        </footer>
      </div>
    </div>
  );
}

/** المفهوم «ب» — ورقٌ فاتح وشريطٌ بلون القسم. لتقدير الثلاثة أشهر.
 *
 *  رُتِّب عن المقترح: كان بين مدّة التقدير والتوقيعين فراغٌ بلا قاعدة.
 *  فصارت الورقة ثلاث كتل بمسافاتٍ ثابتة — الشعار، ثم الاسم ونصّه
 *  ومدّته، ثم التوقيعان على خطٍّ واحد مع تاريخ الإصدار — والفراغ الباقي
 *  يتوزّع حول الكتلة الوسطى لا بعدها. */
function PaperRibbon({ data }: { data: CertificateData }) {
  const dept = data.departmentName?.trim();
  const deptColor = data.colorHex?.trim() || BRAND.temptress;
  // «فاتحٌ جداً» وحده يذوب في الورق (البيج) — أما الأخضر فيُكتب عليه
  // بالداكن لكنه شريطٌ ظاهر، فيبقى بلونه
  const h = deptColor.replace("#", "");
  const lightDept =
    (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) /
      255 >
    0.85;
  // الشريط البيج على ورقٍ فاتح لا يُرى: فيأخذ لونَ الهوية الداكن
  const band = lightDept ? BRAND.temptress : deptColor;
  const bandInk = themeFromColor(band).text === BRAND.ink ? BRAND.temptress : BRAND.beige;
  // لون العنوان الصغير: لونُ القسم إن قُرئ على الورق، وإلا المهوجني
  const accent = lightDept || deptColor.toLowerCase() === BRAND.temptress.toLowerCase()
    ? BRAND.mahogany
    : deptColor.toLowerCase() === BRAND.greenSheen.toLowerCase()
      ? "#2F7A52"
      : deptColor;
  const paper = "#FFFDF9";
  const ink = BRAND.temptress;

  return (
    <div className="relative flex h-full w-full overflow-hidden" style={{ background: paper, color: ink }}>
      <aside
        className="relative flex flex-col items-center justify-between overflow-hidden text-center"
        style={{ width: u(250), background: band, color: bandInk, padding: `${u(56)} ${u(20)}` }}
      >
        <span className="absolute" style={{ bottom: u(-150), right: u(-120) }}>
          <SymbolMark color={bandInk} size={u(330)} opacity={0.12} />
        </span>
        <SymbolMark color={bandInk} size={u(80)} />
        <div className="relative">
          <p style={{ fontSize: u(14), opacity: 0.75 }}>القسم</p>
          <p className="font-extrabold" style={{ fontSize: u(24), lineHeight: 1.5 }}>
            {dept ?? "تَـــلاقِ"}
          </p>
        </div>
        <p className="relative font-bold" style={{ fontSize: u(14), opacity: 0.82 }}>
          نلتقي · نفكّر · نصنع
        </p>
      </aside>

      <section className="relative flex flex-1 flex-col" style={{ padding: `${u(64)} ${u(70)} ${u(48)}` }}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(${ink}0D 1.2px, transparent 1.4px)`,
            backgroundSize: `${u(22)} ${u(22)}`,
          }}
        />
        {/* الشعار الرسمي كما هو — نسخة الخلفية الفاتحة */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/lockup-on-light.png" alt="تَـــلاقِ — TLAQI" className="relative" style={{ height: u(34), width: "auto", alignSelf: "flex-start" }} />

        <div className="relative flex flex-1 flex-col justify-center" style={{ paddingBottom: u(34) }}>
          <p className="font-bold" style={{ fontSize: u(16), color: accent, letterSpacing: "0.02em" }}>
            {certificateHeading(data.kind).ar}
          </p>
          <h1 className="font-extrabold" style={{ fontSize: u(66), lineHeight: 1.25, marginTop: u(10) }}>
            {data.fullName}
          </h1>
          <p className="font-bold" style={{ fontSize: u(19), color: "#5A4E56", marginTop: u(14) }}>
            {data.personTitle}
            {dept ? ` — ${dept === "الإدارة العليا" ? dept : `قسم ${dept}`}` : ""}
          </p>
          <p style={{ fontSize: u(18), lineHeight: 2, color: "#4A4048", maxWidth: u(660), marginTop: u(12) }}>
            تتقدّم تَـــلاقِ بخالص الشكر إلى {data.fullName.trim().split(/\s+/)[0]}، {certificateBody(data)}
          </p>
          <span
            className="inline-flex items-center"
            style={{
              alignSelf: "flex-start",
              marginTop: u(16),
              fontSize: u(14),
              padding: `${u(7)} ${u(16)}`,
              borderRadius: u(99),
              background: BRAND.beige,
              color: ink,
            }}
          >
            {longDate(data.period.start)} ← {longDate(data.period.end)}
          </span>
        </div>

        <footer className="relative flex items-end" style={{ gap: u(48) }}>
          {data.signers.map((s, i) => (
            <Signer key={i} s={s} ink={ink} rule="#D8CFC9" muted="#8A8088" width="auto" align="start" grow />
          ))}
          <p style={{ fontSize: u(11.5), lineHeight: 1.8, color: "#8A8088", whiteSpace: "nowrap" }}>
            صدرت في {shortDate(new Date())}
            <br />
            صادرة من إدارة تَـــلاقِ
          </p>
        </footer>
      </section>
    </div>
  );
}

/** موقِّعٌ واحد: توقيعُه المعتمَد فوق السطر، وصفتُه واسمُه تحته.
 *
 *  ومن لا توقيع معتمَد له يبقى سطرُه فارغاً واسمُه تحته: نسبةٌ لا
 *  انتحال — ولا يُستعار توقيعُ من سبقه في المنصب. */
function Signer({
  s,
  ink,
  rule,
  muted,
  width,
  align = "center",
  grow,
}: {
  s: CertificateSigner;
  ink: string;
  rule: string;
  muted: string;
  width: string;
  align?: "center" | "start";
  grow?: boolean;
}) {
  return (
    <div style={{ width, flex: grow ? 1 : undefined, textAlign: align === "center" ? "center" : "start" }}>
      <div className="flex items-end" style={{ height: u(46), justifyContent: align === "center" ? "center" : "flex-start" }}>
        {s.signatureImage && (
          // التوقيع يُقنَّع ويُملأ بحبر الشهادة: خلفياتُ الشهادة مختلفة،
          // وحبرُ التوقيع الأصلي يصحّ على بعضها ويختفي على بعض
          <span
            aria-hidden="true"
            style={{
              display: "block",
              width: "80%",
              height: u(46),
              background: ink,
              maskImage: `url(${s.signatureImage})`,
              WebkitMaskImage: `url(${s.signatureImage})`,
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: align === "center" ? "center bottom" : "right bottom",
              WebkitMaskPosition: align === "center" ? "center bottom" : "right bottom",
            }}
          />
        )}
      </div>
      <span className="block" style={{ height: "1px", background: rule, margin: `${u(6)} 0 ${u(9)}` }} />
      <p className="font-bold" style={{ fontSize: u(15.5) }}>
        {s.title}
      </p>
      <p style={{ fontSize: u(13.5), color: muted, marginTop: u(2) }}>{s.name}</p>
    </div>
  );
}

/** نسب الرمز الرسمي كما هي في ملف الهوية: 512 × 725 */
const MARK_RATIO = 725 / 512;
const MARK_SRC = "/brand/symbol-mark.png";

/** رمز تَـــلاقِ الرسمي — الأصل نفسه، لا رسمٌ يحاكيه.
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
