import { gx, type MaybeGender } from "@/lib/gender";
import { serviceDurationAr } from "@/lib/certificateStyle";
import { anniversaryDate, orgCalendarDate, ORG_TIME_ZONE } from "@/lib/anniversary";

/** **أنواعُ الشهادات الستة المعتمدة** — كما في لوحات الاعتماد (02a–02e) وواجهة الإصدار.
 *
 *  وحدةٌ بلا قاعدةٍ ولا خادم: منها تُبنى المعاينةُ الحيّة في المتصفّح، ومنها
 *  تُبنى الشهادةُ المطبوعة بعد صدورها — فما يُعاين هو ما يصدر حرفاً بحرف.
 *
 *  | النوع          | القالب               | حرف الرقم |
 *  |----------------|----------------------|-----------|
 *  | شكر وتقدير ٣ أشهر | الإطار الكلاسيكي   | —         |
 *  | إنجاز          | الإطار الكلاسيكي     | —         |
 *  | تعيين          | الترويسة التحريرية   | A         |
 *  | قيادة          | الإطار الكلاسيكي     | L         |
 *  | عضوية ومشاركة  | الإطار الكلاسيكي     | —         |
 *  | شكر وخبرة (ختام) | الإطار الكلاسيكي   | —         | */
export type CertificateType = "appreciation" | "achievement" | "appointment" | "leadership" | "membership" | "final";

/** ترتيبُ الأنواع كما في واجهة الإصدار المعتمدة */
export const CERTIFICATE_TYPES: CertificateType[] = [
  "appreciation",
  "achievement",
  "appointment",
  "leadership",
  "membership",
  "final",
];

export type CertificateTemplate = "classic" | "editorial";

type TypeInfo = {
  chip: string;
  template: CertificateTemplate;
  heading: { ar: string; en: string };
  /** حرفُ النوع في رقم الشهادة — للقيادة والتعيين وحدهما */
  letter: string | null;
  /** سطرُ التقديم، و`{TLAQI}` موضعُ الاسم */
  intro: string;
};

export const TYPE_INFO: Record<CertificateType, TypeInfo> = {
  appreciation: {
    chip: "شكر وتقدير — ٣ أشهر",
    template: "classic",
    heading: { ar: "شهادة تقدير — ثلاثة أشهر", en: "Certificate of Appreciation · 3 Months" },
    letter: null,
    intro: "تتقدّم {TLAQI} بخالص الشكر والتقدير إلى",
  },
  achievement: {
    chip: "إنجاز",
    template: "classic",
    heading: { ar: "شهادة إنجاز", en: "Certificate of Achievement" },
    letter: null,
    intro: "تُمنح هذه الشهادة من {TLAQI} إلى",
  },
  appointment: {
    chip: "تعيين",
    template: "editorial",
    heading: { ar: "شهادة تعيين", en: "Certificate of Appointment" },
    letter: "A",
    intro: "تُعلن {TLAQI} تعيين",
  },
  leadership: {
    chip: "قيادة",
    template: "classic",
    heading: { ar: "شهادة قيادة", en: "Certificate of Leadership" },
    letter: "L",
    intro: "تتقدّم {TLAQI} بالشكر والتقدير إلى",
  },
  membership: {
    chip: "عضوية ومشاركة",
    template: "classic",
    heading: { ar: "شهادة عضوية ومشاركة", en: "Certificate of Membership" },
    letter: null,
    intro: "تشهد {TLAQI} بأن",
  },
  final: {
    chip: "شكر وخبرة (ختام)",
    template: "classic",
    heading: { ar: "شهادة شكر وخبرة", en: "Certificate of Appreciation & Experience" },
    letter: null,
    intro: "تتقدّم {TLAQI} بخالص الشكر والامتنان إلى",
  },
};

export const TEMPLATE_INFO: Record<CertificateTemplate, { name: string; types: string }> = {
  classic: { name: "الإطار الكلاسيكي", types: "شكر وتقدير · إنجاز · قيادة · عضوية" },
  editorial: { name: "الترويسة التحريرية", types: "شهادة التعيين" },
};

/** بياناتُ الشهادة كما تُطبع — نصوصٌ كلّها، والتواريخ `yyyy-mm-dd` */
export type CertificateFields = {
  printedName: string;
  title: string;
  unit: string;
  sentence: string;
  joinDate?: string;
  duration?: string;
  periodStart?: string;
  periodEnd?: string;
  achievement?: string;
  achievementDate?: string;
  role?: string;
  committee?: string;
  department?: string;
  leadTitle?: string;
  appointmentDate?: string;
};

export type FieldKey = keyof CertificateFields;
type FieldSpec = { key: FieldKey; label: string; input: "text" | "date" | "textarea"; required?: boolean };

/** حقولُ كل نوع بترتيبها في «بيانات الشهادة» */
export const FIELD_SPECS: Record<CertificateType, FieldSpec[]> = {
  appreciation: [
    { key: "printedName", label: "الاسم كما يُطبع", input: "text", required: true },
    { key: "title", label: "المسمى", input: "text" },
    { key: "unit", label: "القسم / اللجنة", input: "text" },
    { key: "joinDate", label: "تاريخ الانضمام", input: "date", required: true },
    { key: "duration", label: "المدة على الشهادة", input: "text", required: true },
    { key: "sentence", label: "نص التقدير", input: "textarea", required: true },
  ],
  achievement: [
    { key: "printedName", label: "الاسم كما يُطبع", input: "text", required: true },
    { key: "title", label: "المسمى", input: "text" },
    { key: "unit", label: "القسم / اللجنة", input: "text" },
    { key: "achievement", label: "الإنجاز", input: "text", required: true },
    { key: "achievementDate", label: "تاريخ الإنجاز", input: "date", required: true },
    { key: "sentence", label: "نص التقدير", input: "textarea", required: true },
  ],
  appointment: [
    { key: "printedName", label: "الاسم كما يُطبع", input: "text", required: true },
    { key: "role", label: "صفة التعيين", input: "text", required: true },
    { key: "committee", label: "اللجنة", input: "text", required: true },
    { key: "department", label: "القسم", input: "text" },
    { key: "leadTitle", label: "المسمى القيادي", input: "text", required: true },
    { key: "appointmentDate", label: "تاريخ التعيين", input: "date", required: true },
    { key: "sentence", label: "نص الثقة", input: "textarea", required: true },
  ],
  leadership: [
    { key: "printedName", label: "الاسم كما يُطبع", input: "text", required: true },
    { key: "title", label: "المسمى", input: "text" },
    { key: "unit", label: "القسم / اللجنة", input: "text" },
    { key: "periodStart", label: "بداية القيادة", input: "date", required: true },
    { key: "periodEnd", label: "نهاية الفترة", input: "date", required: true },
    { key: "duration", label: "مدة القيادة", input: "text", required: true },
    { key: "sentence", label: "نص التقدير", input: "textarea", required: true },
  ],
  membership: [
    { key: "printedName", label: "الاسم كما يُطبع", input: "text", required: true },
    { key: "title", label: "المسمى", input: "text" },
    { key: "unit", label: "القسم / اللجنة", input: "text" },
    { key: "joinDate", label: "تاريخ الانضمام", input: "date", required: true },
    { key: "duration", label: "مدة المشاركة", input: "text", required: true },
    { key: "sentence", label: "نص الشهادة", input: "textarea", required: true },
  ],
  final: [
    { key: "printedName", label: "الاسم كما يُطبع", input: "text", required: true },
    { key: "title", label: "المسمى", input: "text" },
    { key: "unit", label: "القسم / اللجنة", input: "text" },
    { key: "periodStart", label: "بداية المسيرة", input: "date", required: true },
    { key: "periodEnd", label: "نهاية المسيرة", input: "date", required: true },
    { key: "duration", label: "مدة المشاركة", input: "text", required: true },
    { key: "sentence", label: "نص الشكر", input: "textarea", required: true },
  ],
};

/** ما تعرفه المنصة عن المستلِم — يُملأ منه النموذجُ أولاً، ويُعدَّل بعده بيد المُصدِر */
export type RecipientFacts = {
  fullName: string;
  gender: MaybeGender;
  jobTitle: string | null;
  /** صفتُه القيادية كما تُكتب («قائدة قسم التسويق») — للقادة */
  leadTitle: string | null;
  departmentName: string | null;
  /** بدايةُ التكليف (ISO) — مرساةُ الثلاثة أشهر */
  assignmentStart: string;
  /** يومُ اكتمال الثلاثة أشهر (ISO) — بالتقويم وتوقيت المنظمة (`anniversaryDate`) */
  appreciationDue: string;
  /** أكمل الثلاثة أشهر اليوم؟ يحكم به الخادم (`completedThreeMonths`) — والواجهةُ تعرضه */
  completedThreeMonths: boolean;
  /** بدايةُ المسيرة كلّها (ISO) — للختام */
  serviceStart: string;
  /** نهايةُ المسيرة (ISO) إن بدأ ختامُها */
  serviceEnd: string | null;
  /** اللجنة التي يقودها إن وُجدت */
  committeeName: string | null;
};

/** اليومُ بتقويم المنظمة (`yyyy-mm-dd`) — لا بتوقيت الخادم ولا المتصفّح */
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => {
  const c = orgCalendarDate(d);
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
};
const day = (s: string | undefined) => (s ? new Date(`${s}T12:00:00Z`) : null);

/** «٢٠ أكتوبر ٢٠٢٦» — كما يُقرأ على ورقة. التاريخُ المجرّد (`yyyy-mm-dd`) يُقرأ كما
 *  كُتب، واللحظةُ (يومُ الإصدار) بتقويم المنظمة — فلا يتبدّل يومُها بتوقيت الخادم. */
export function longDateAr(s: string | Date | undefined | null): string {
  if (!s) return "—";
  const dateOnly = typeof s === "string" && s.length <= 10;
  const d = typeof s === "string" ? (dateOnly ? day(s) : new Date(s)) : s;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-u-ca-gregory-nu-arab", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : ORG_TIME_ZONE,
  }).format(d);
}

/** المدّةُ الفعلية بين تاريخين بالعربية — «شهران و١٢ يوماً» */
export function durationBetween(a: string | undefined, b: string | undefined): string {
  const s = day(a);
  const e = day(b);
  return s && e ? serviceDurationAr(s, e) : "—";
}

/** «قسم التسويق» — إلا ما بدأ بـ«قسم» أو «لجنة» أو «الإدارة العليا» */
export function unitPhrase(unit: string): string {
  const u = unit.trim();
  if (!u) return "";
  return /^(قسم|لجنة|إدارة|فريق|وحدة)\s/.test(u) || u === "الإدارة العليا" ? u : `قسم ${u}`;
}

function committeeNamed(name: string): string {
  const n = name.trim();
  return !n ? "اللجنة" : n.startsWith("لجنة") ? n : `لجنة ${n}`;
}

/** النصُّ المقترح لكل نوع، بجنس صاحبه — ومن لم يختر جنسه فبالمصدر */
export function defaultSentence(type: CertificateType, f: CertificateFields, g: MaybeGender): string {
  const G = (m: string, fe: string, n: string) => gx(g, m, fe, n);
  switch (type) {
    case "appreciation":
      return `تقديراً ${G("لعطائه", "لعطائها", "للعطاء")} خلال ثلاثة أشهرٍ من العمل والتعلّم، ${G("وإسهامه", "وإسهامها", "والإسهام")} في بناء ما نطمح إليه معاً.`;
    case "achievement":
      return `تقديراً ${G("لإنجازه", "لإنجازها", "لإنجاز")} ${f.achievement?.trim() || "…"}، ولما ${G("أظهره", "أظهرته", "ظهر فيه")} من دقّةٍ وروحِ فريق.`;
    case "appointment":
      return `ثقةً ${G("بكفاءته", "بكفاءتها", "بالكفاءة")}، وتطلّعاً إلى ما ${G("سيقوده", "ستقوده", "سيُقاد")} من عملٍ يجمع أعضاء اللجنة على هدفٍ واحد ويصنع أثراً يليق بالفريق.`;
    case "leadership":
      return `تقديراً ${G("لقيادته", "لقيادتها", "لقيادة")} فريقَ ${f.unit?.trim() || "القسم"} برؤيةٍ واضحة، ${G("وبنائه", "وبنائها", "وبناء")} فريقاً يعمل بثقةٍ ويصنع أثراً يتجاوز حدود القسم.`;
    case "membership":
      return `عضوٌ في فريقها منذ ${longDateAr(f.joinDate)}، ${G("شارك", "شاركت", "شارك")} في أعماله ${G("وأسهم", "وأسهمت", "وأسهم")} في بنائه.`;
    case "final":
      return `تقديراً لما ${G("قدّمه", "قدّمته", "قُدِّم")} خلال ${G("مسيرته", "مسيرتها", "المسيرة")} معنا، ${G("وإسهامه", "وإسهامها", "والإسهام")} في بناء ما نطمح إليه معاً — ${G("ونتمنّى له", "ونتمنّى لها", "ونتمنّى")} مستقبلاً حافلاً بالإنجازات.`;
  }
}

/** **الحقولُ المشتقّة** — تتبع غيرَها ما لم يكتبها المُصدِر بيده:
 *  - النصُّ (كلُّ نوع): من الإنجاز والقسم وتاريخ الانضمام وجنس صاحبها.
 *  - صفةُ التعيين: من اسم اللجنة.
 *  - المدّة: من التاريخين — وللتقدير حتى يوم استحقاقه إن مضى (`appreciationEnd`).
 *  فما كُتب يدوياً منها يُقارَن بما يُشتقّ، ويُسجَّل فرقُه تعديلاً يدوياً. */
export const DERIVED_KEYS: Record<CertificateType, FieldKey[]> = {
  appreciation: ["duration", "sentence"],
  achievement: ["sentence"],
  appointment: ["role", "sentence"],
  leadership: ["duration", "sentence"],
  membership: ["duration", "sentence"],
  final: ["duration", "sentence"],
};

/** يوم نهاية مدّة التقدير: اليوم، أو يوم الاستحقاق إن مضى — فمن كُرِّم متأخّراً تبقى «٣ أشهر» */
function appreciationEnd(joinDate: string | undefined, today: string): string {
  const j = day(joinDate);
  if (!j) return today;
  const due = iso(anniversaryDate(j, 3));
  return today < due ? today : due;
}

export function deriveFields(
  type: CertificateType,
  f: CertificateFields,
  g: MaybeGender,
  now = new Date()
): Pick<CertificateFields, "sentence" | "role" | "duration"> {
  const G = (m: string, fe: string, n: string) => gx(g, m, fe, n);
  const today = iso(now);
  const out: Pick<CertificateFields, "sentence" | "role" | "duration"> = { sentence: "" };
  if (type === "appreciation") out.duration = durationBetween(f.joinDate, appreciationEnd(f.joinDate, today));
  if (type === "membership") out.duration = durationBetween(f.joinDate, today);
  if (type === "leadership" || type === "final") out.duration = durationBetween(f.periodStart, f.periodEnd);
  if (type === "appointment") {
    const c = f.committee?.trim() ? committeeNamed(f.committee) : "";
    out.role = c ? G(`قائداً ل${c}`, `قائدةً ل${c}`, `لقيادة ${c}`) : "";
  }
  out.sentence = defaultSentence(type, { ...f, ...out, sentence: "" }, g);
  return out;
}

/** يطبّق الاشتقاق على ما لم يكتبه المُصدِر بيده (`touched`) */
export function applyDerived(
  type: CertificateType,
  f: CertificateFields,
  g: MaybeGender,
  touched: ReadonlySet<FieldKey> = new Set(),
  now = new Date()
): CertificateFields {
  const d = deriveFields(type, f, g, now) as Partial<CertificateFields>;
  const next = { ...f };
  for (const k of DERIVED_KEYS[type]) if (!touched.has(k)) (next as Record<string, unknown>)[k] = d[k] ?? "";
  return next;
}

/** البياناتُ الأولى لكل نوع — من ملف المستلِم، قبل أن يعدّلها المُصدِر */
export function defaultFields(type: CertificateType, r: RecipientFacts, now = new Date()): CertificateFields {
  const g = r.gender;
  const G = (m: string, fe: string, n: string) => gx(g, m, fe, n);
  const today = iso(now);
  const base: CertificateFields = {
    printedName: r.fullName,
    title: r.leadTitle ?? r.jobTitle?.trim() ?? "",
    unit: r.departmentName ?? "",
    sentence: "",
  };
  let f: CertificateFields;
  switch (type) {
    case "appreciation":
    case "membership":
      f = { ...base, joinDate: r.assignmentStart.slice(0, 10) };
      break;
    case "achievement":
      f = { ...base, achievement: "", achievementDate: today };
      break;
    case "leadership":
      f = { ...base, periodStart: r.assignmentStart.slice(0, 10), periodEnd: today };
      break;
    case "final":
      f = {
        ...base,
        periodStart: r.serviceStart.slice(0, 10),
        periodEnd: (r.serviceEnd ? iso(new Date(r.serviceEnd)) : today),
      };
      break;
    case "appointment":
      f = {
        printedName: r.fullName,
        title: "",
        unit: "",
        sentence: "",
        committee: r.committeeName ? committeeNamed(r.committeeName) : "",
        department: r.departmentName ?? "",
        leadTitle: G("قائد اللجنة", "قائدة اللجنة", "قيادة اللجنة"),
        appointmentDate: today,
      };
      break;
  }
  return applyDerived(type, f, g, new Set(), now);
}

/** المدّةُ الفعلية التي تقيسها المنصة — تُسجَّل إن عُدّلت المدةُ المطبوعة يدوياً */
export function actualDuration(type: CertificateType, r: RecipientFacts, now = new Date()): string | null {
  if (type === "appreciation") return durationBetween(r.assignmentStart.slice(0, 10), iso(now));
  return defaultFields(type, r, now).duration ?? null;
}

/** المناسبة: لا تصدر شهادتان لمناسبةٍ واحدة (`memberId` + `occasion` فريدان) */
export function occasionFor(type: CertificateType, f: CertificateFields): string {
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  switch (type) {
    case "achievement":
      return `achievement:${norm(f.achievement)}`;
    case "appointment":
      return `appointment:${norm(f.committee || f.role)}`;
    case "leadership":
      return `leadership:${norm(f.periodStart)}`;
    default:
      return type;
  }
}

/** ما يُطلب قبل الإصدار — الخادمُ يفحصه ثانيةً */
export function missingFields(type: CertificateType, f: CertificateFields): string[] {
  return FIELD_SPECS[type].filter((s) => s.required && !String(f[s.key] ?? "").trim()).map((s) => s.label);
}

/** ما عُدّل يدوياً — يُسجَّل مع الشهادة.
 *  الحقلُ المشتقّ يُقارَن بما يُشتقّ من البيانات المُرسَلة نفسها (فكتابةُ الإنجاز لا تجعل
 *  نصَّه «معدَّلاً»)، وسواه يُقارَن بالأصل من ملف صاحبها. والحقلُ الفارغ أصلاً
 *  (الإنجاز) إدخالٌ لا تعديل. */
export function fieldEdits(
  type: CertificateType,
  before: CertificateFields,
  after: CertificateFields,
  g: MaybeGender,
  now = new Date()
) {
  const derived = deriveFields(type, after, g, now) as Partial<CertificateFields>;
  return FIELD_SPECS[type]
    .map((s) => {
      const base = DERIVED_KEYS[type].includes(s.key) ? derived[s.key] : before[s.key];
      return { s, from: String(base ?? "").trim(), to: String(after[s.key] ?? "").trim() };
    })
    .filter(({ from, to }) => from !== "" && from !== to)
    .map(({ s, from, to }) => ({ field: s.label, key: s.key, from, to }));
}

export type CertificateSignerView = { title: string; name: string; signatureImage: string | null };

/** الشهادةُ كما تُرسم — للقالبين */
export type CertificateView = {
  type: CertificateType;
  template: CertificateTemplate;
  colorHex: string;
  heading: { ar: string; en: string };
  intro: string;
  fullName: string;
  /** الكلاسيكي: «كاتبة محتوى — قسم التسويق» */
  personLine: string;
  /** التحريري: «قائدةً للجنة المحتوى الرقمي» */
  role: string | null;
  body: string;
  facts: Array<[string, string]>;
  number: string | null;
  issuedAt: string;
  /** موقِّعان، أو موقِّعٌ واحد (شهادةُ الرئيس التنفيذي: المؤسسُ وحده) */
  signers: CertificateSignerView[];
};

/** من بيانات الشهادة إلى رسمها — المعاينةُ والشهادةُ الصادرة من الدالّة نفسها */
export function buildView(
  type: CertificateType,
  f: CertificateFields,
  ctx: { colorHex: string; number: string | null; issuedAt: string; signers: CertificateSignerView[] }
): CertificateView {
  const info = TYPE_INFO[type];
  const unit = unitPhrase(f.unit ?? "");
  const title = f.title?.trim() ?? "";
  const personLine = [title, unit].filter(Boolean).join(" — ");
  const num: Array<[string, string]> = ctx.number ? [["رقم الشهادة", ctx.number]] : [];
  let facts: Array<[string, string]>;
  switch (type) {
    case "appreciation":
    case "membership":
      facts = [["تاريخ الانضمام", longDateAr(f.joinDate)], ["مدة المشاركة", f.duration || "—"], ...num];
      break;
    case "achievement":
      facts = [["الإنجاز", f.achievement || "—"], ["تاريخ الإنجاز", longDateAr(f.achievementDate)], ...num];
      break;
    case "leadership":
      facts = [
        ["مدة القيادة", f.duration || "—"],
        ["الفترة", `${longDateAr(f.periodStart)} — ${longDateAr(f.periodEnd)}`],
        ...num,
      ];
      break;
    case "final":
      facts = [
        ["الفترة", `${longDateAr(f.periodStart)} — ${longDateAr(f.periodEnd)}`],
        ["مدة المشاركة", f.duration || "—"],
        ...num,
      ];
      break;
    case "appointment":
      facts = [
        ["اللجنة", f.committee || "—"],
        ["القسم", f.department || "—"],
        ["المسمى القيادي", f.leadTitle || "—"],
        ["تاريخ التعيين", longDateAr(f.appointmentDate)],
      ];
      break;
  }
  return {
    type,
    template: info.template,
    colorHex: ctx.colorHex,
    heading: info.heading,
    intro: info.intro,
    fullName: f.printedName,
    personLine,
    role: type === "appointment" ? f.role?.trim() || null : null,
    body: f.sentence,
    facts,
    number: ctx.number,
    issuedAt: ctx.issuedAt,
    signers: ctx.signers,
  };
}

export function isCertificateType(v: unknown): v is CertificateType {
  return typeof v === "string" && (CERTIFICATE_TYPES as string[]).includes(v);
}
