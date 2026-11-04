import { notFound } from "next/navigation";
import {
  certificateFor,
  certificateBody,
  certificateHeading,
  appreciationFullTerm,
  serviceDurationAr,
  verifyCertificateToken,
  verifyRegistryToken,
  isRegistryToken,
  type CertificateData,
} from "@/lib/certificate";
import { issuedCertificateView } from "@/lib/certificateRegistry";
import { TYPE_INFO, longDateAr, unitPhrase, type CertificateView } from "@/lib/certificateTypes";
import { CertificateSheet, CertificateFrameBox } from "@/components/certificates/CertificateSheet";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** الشهادات — صفحةٌ تُطبع، بالقالبين المعتمدين («الإطار الكلاسيكي» و«الترويسة التحريرية»).
 *
 *  **رابطان:**
 *  - رابطُ **سجل الشهادات الصادرة** (`r.…`): الشهادةُ من لقطتها الثابتة — نوعُها ورقمُها
 *    وبياناتُها كما طُبعت، وتوقيعا يوم صدورها.
 *  - الرابطُ **القديم** بمعرّف العضو (شكر وخبرة، وتقدير الثلاثة أشهر): روابطُ وصلت بريدَ
 *    أصحابها قبل السجل، فتبقى تعمل وتُرسم بالورقة نفسها.
 *
 *  صفحةٌ لا صورة: تُفتح بلا تسجيل دخول (صاحبها قد خرج وحسابه مُعطَّل)، وتُطبع PDF
 *  بضغطة، وتبقى نصّاً يُقرأ ويُكبَّر. والرابطُ موقَّع، فلا تُقرأ شهادة أحدٍ بتخمين معرّفه. */
export default async function CertificatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const raw = decodeURIComponent(token);
  let view: CertificateView | null = null;
  if (isRegistryToken(raw)) {
    const id = verifyRegistryToken(raw);
    if (!id) notFound();
    view = await issuedCertificateView(id);
  } else {
    const verified = verifyCertificateToken(raw);
    if (!verified) notFound();
    const data = await certificateFor(verified.memberId, verified.kind);
    view = data ? legacyView(data) : null;
  }
  if (!view) notFound();

  return (
    <main className="min-h-screen bg-[#1A1023] p-4 print:bg-white print:p-0">
      {/* الورقة A4 عرضيّة بلا هوامش — مقاسُ القالب المعتمد. هنا لا في الأنماط العامة: يخصّ هذه الصفحة */}
      <style>{"@page { size: A4 landscape; margin: 0; }"}</style>
      <PrintButton />
      {/* الشهادةُ ورقةٌ A4 عرضيّة: على شاشة الجوّال تصغر كلُّها معاً، فيُدَلّ قارئُها على القراءة الواضحة */}
      <p className="mx-auto mb-3 max-w-[1123px] text-center text-xs leading-relaxed text-[#EEF6DF]/75 sm:hidden print:hidden">
        للقراءة على الجوّال: كبّر الصفحة بإصبعين، أو احفظها PDF من الزرّ أعلاه.
      </p>
      <CertificateFrameBox className="mx-auto max-w-[1123px] print:max-w-none print:rounded-none">
        <CertificateSheet view={view} />
      </CertificateFrameBox>
    </main>
  );
}

/** شهادةٌ صدرت قبل السجل — تُرسم بالورقة نفسها من بيانات صاحبها كما كانت تُرسم:
 *  العنوانُ والنصُّ والبياناتُ هي هي، والمبكرةُ تبقى «شهادة تقدير» بلا «ثلاثة أشهر». */
function legacyView(data: CertificateData): CertificateView {
  const type = data.kind === "appreciation" ? "appreciation" : "final";
  const fullTerm = data.kind !== "appreciation" || appreciationFullTerm(data.period);
  const duration = serviceDurationAr(data.period.start, data.period.end);
  const unit = unitPhrase(data.departmentName ?? "");
  return {
    type,
    template: "classic",
    colorHex: data.colorHex,
    heading: certificateHeading(data.kind, fullTerm),
    intro: TYPE_INFO[type].intro,
    fullName: data.fullName,
    personLine: [data.personTitle, unit].filter(Boolean).join(" — "),
    role: null,
    body: certificateBody(data),
    facts:
      type === "appreciation"
        ? [
            ["تاريخ الانضمام", longDateAr(data.period.start)],
            ["مدة المشاركة", duration],
          ]
        : [
            ["الفترة", `${longDateAr(data.period.start)} — ${longDateAr(data.period.end)}`],
            ["مدة المشاركة", duration],
          ],
    number: null,
    issuedAt: data.issuedAt.toISOString(),
    signers: data.signers,
  };
}
