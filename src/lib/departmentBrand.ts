import { BRAND, themeFromColor, logoToneFor } from "@/lib/brand";

/** هوية القسم: لونه ونبرته ونصُّ ترحيبه — في ملفٍّ واحد.
 *
 *  كانت هوية القسم موزّعة: لونه في القاعدة، ولوحته في `themeFromColor`،
 *  ونصُّ ترحيبه مكتوباً في القالب بصيغة القسم التقني وحده. فمن انضمّ
 *  للتسويق قُرئ عليه كلامُ المبرمجين، ومن أُضيف قسمُه غداً لم يجد لنفسه
 *  نصّاً ولا لوناً.
 *
 *  فصار الكلّ هنا: يُسأل هذا الملفّ باسم القسم فيُجيب بكلّ ما يخصّه —
 *  أو يُقرّ صريحاً أنه لا يعرفه (`known: false`) فيُحتاط بالبديل
 *  المعتمد ويُعلَم أن في الإعداد نقصاً، بدل أن يُخمَّن لونٌ أو تُنسَب
 *  إلى القسم مسؤوليّاتٌ لم يطلبها أحد.
 */

/** ما يقال لمن انضمّ — الفرق بين قسمٍ وقسم ثلاث جُمَل لا كلمة */
export type DepartmentCopy = {
  /** كما يُذكر في الجملة: «إلى القسم التقني»، «إلى قسم التسويق» */
  phrase: string;
  /** بما نؤمن في هذا القسم، وماذا يعني انضمامه إليه */
  belief: string;
  /** ما نتطلّع إلى صنعه معه */
  aspiration: string;
};

export type DepartmentBrand = {
  /** هل لهذا القسم إعدادٌ رسمي، أم هذا البديل المعتمد؟ */
  known: boolean;
  name: string;
  /** اللون الرسمي للقسم */
  primary: string;
  /** لونٌ مساند من الهوية — للتفاصيل لا للخلفيات */
  secondary: string;
  /** الخلفية الفاتحة والداكنة لنفس الهوية */
  light: string;
  dark: string;
  /** نسخة الشعار التي تصحّ على لون القسم */
  logoTone: ReturnType<typeof logoToneFor>;
  copy: DepartmentCopy;
};

/** صيغةٌ ثابتة لا تتبدّل بالقسم: ما بعدها توقيعٌ وما قبلها ترحيب */
export const WELCOME_CLOSING = "أهلاً بك بيننا، ونتطلّع إلى ما سنصنعه معاً.";

/** الأقسام المعروفة رسمياً.
 *
 *  المفتاح اسمُ القسم كما هو في القاعدة — فهو ما يُقرأ من سجلّ العضو،
 *  ولا يُضاف وسيطٌ ثالث (slug) يحتاج مزامنةً مع الاثنين. */
const DEPARTMENTS: Record<string, { primary: string; copy: DepartmentCopy }> = {
  "التقنية": {
    primary: BRAND.greenSheen,
    copy: {
      phrase: "القسم التقني",
      belief:
        "نؤمن بأن الحلول التقنية المميزة تبدأ بعقولٍ تُبدع وتحوّل الأفكار إلى واقع. وانضمامك إلينا يمثّل إضافةً جديدة لرحلتنا في بناء وتطوير الحلول والأنظمة التي تصنع أثراً حقيقياً.",
      aspiration:
        "نتطلّع إلى أن نطوّر معاً، ونبتكر، ونبني تجارب تقنية ترتقي بمنصة تَـــلاقِ وتحقّق طموحاتنا.",
    },
  },
  "التسويق": {
    primary: BRAND.mahogany,
    copy: {
      phrase: "قسم التسويق",
      belief:
        "نؤمن بأن الأفكار العظيمة تستحقّ أن تصل إلى العالم، وأن الهوية القوية تُبنى بالتواصل الإبداعي والقصص التي تعبّر عن رسالتنا. وانضمامك إلينا يمثّل إضافةً جديدة لرحلتنا في تعزيز حضور تَـــلاقِ، وإبراز أثرها، وبناء علاقة مميزة مع جمهورنا.",
      aspiration:
        "نتطلّع إلى أن نصنع معاً أفكاراً مُلهمة، ونطوّر حضور المنصة، ونوصل رسالتنا بأساليب إبداعية تليق بطموحاتنا.",
    },
  },
  "الموارد البشرية": {
    primary: BRAND.beige,
    copy: {
      phrase: "قسم الموارد البشرية",
      belief:
        "نؤمن بأن الناس أثمنُ ما تملكه أيُّ منظمة، وأن الفريق الذي يُختار بعنايةٍ ويُرعى باهتمامٍ هو الذي يصنع الفرق. وانضمامك إلينا يمثّل إضافةً جديدة لرحلتنا في استقطاب الكفاءات وبناء بيئةِ عملٍ عادلةٍ تُنمّي أصحابها.",
      aspiration:
        "نتطلّع إلى أن نبني معاً سياساتٍ واضحة، ونرتّب مسارات النمو، ونجعل تجربة كلّ عضوٍ في تَـــلاقِ تجربةً تُروى.",
    },
  },
  "الإدارة العليا": {
    primary: BRAND.temptress,
    copy: {
      phrase: "الإدارة العليا",
      belief:
        "نؤمن بأن القرار الصائب يُبنى على رؤيةٍ واضحة وحوكمةٍ لا تُجامل، وأن القيادة أمانةٌ قبل أن تكون صفة. وانضمامك إلينا يمثّل إضافةً جديدة لرحلتنا في رسم اتجاه المنصة وصيانة مبادئها.",
      aspiration:
        "نتطلّع إلى أن نرسم معاً الاتجاه، ونحمي الميثاق، ونتّخذ القرارات التي تُبقي تَـــلاقِ وفيّةً لما قامت عليه.",
    },
  },
};

/** من لا قسم له: مسؤول التشغيل يعمل عبر الأقسام كلّها لا داخل أحدها */
const NO_DEPARTMENT: DepartmentCopy = {
  phrase: "فريق التشغيل",
  belief:
    "نؤمن بأن الفكرة لا تكتمل حتى تُدار يوماً بيوم، وأن الانتظام هو ما يحوّل الخطّة إلى نتيجة. وانضمامك إلينا يمثّل إضافةً جديدة لرحلتنا في إدارة العمل اليومي وإبقاء المسار منتظماً.",
  aspiration:
    "نتطلّع إلى أن نُحكِم معاً إيقاع العمل، ونتابع المهامّ حتى تُقفل، ونجعل التشغيل في تَـــلاقِ سلساً لا يتعثّر.",
};

/** نصُّ قسمٍ لا إعدادَ له.
 *
 *  لا يَنسب إليه مسؤوليّةً بعينها عمداً: اختراعُ مهمّةٍ لقسمٍ لا نعرفه
 *  أسوأ من الترحيب العام — يقرأ العضو وصفاً لعملٍ ليس عمله. */
function fallbackCopy(name: string): DepartmentCopy {
  const phrase = /^(قسم|إدارة|فريق|وحدة)\s/.test(name) ? name : `قسم ${name}`;
  return {
    phrase,
    belief:
      "نؤمن بأن كلّ قسمٍ في تَـــلاقِ يحمل جزءاً من الأثر الذي نسعى إليه، وأن انضمام الكفاءات هو ما يوسّع هذا الأثر. وانضمامك إلينا يمثّل إضافةً جديدة لرحلتنا.",
    aspiration: `نتطلّع إلى أن نعمل معاً على ما يخصّ ${name}، ونطوّره، ونصنع به أثراً يليق بطموحاتنا.`,
  };
}

/** هوية القسم كاملةً.
 *
 *  `name` اسمُ القسم من سجلّ العضو، و`null` لمن لا قسم له.
 *  و`colorHex` لونُه المسجَّل في القاعدة — فهو المصدر الرسمي للّون،
 *  وما في هذا الملفّ نسخةٌ احتياطية لا بديلٌ عنه. */
export function departmentBrand(
  name: string | null | undefined,
  colorHex?: string | null
): DepartmentBrand {
  const key = name?.trim() || null;
  const entry = key ? DEPARTMENTS[key] : null;
  const copy = key ? (entry?.copy ?? fallbackCopy(key)) : NO_DEPARTMENT;

  // اللون المسجَّل أولاً، فالرسمي، فالبديل المعتمد
  const primary = colorHex?.trim() || entry?.primary || BRAND.temptress;
  const theme = themeFromColor(primary);

  return {
    // «معروف» تعني أن له نصّاً ولوناً رسميين — ومن لا قسم له معروفٌ أيضاً
    known: key === null || Boolean(entry),
    name: key ?? "تَـــلاقِ",
    primary,
    secondary: theme.text === BRAND.ink ? BRAND.mahogany : BRAND.beige,
    light: theme.surface,
    dark: theme.accentDark,
    logoTone: logoToneFor(theme),
    copy,
  };
}

/** نصُّ الترحيب جملةً جملة — ليُركّب في القالب لا ليُكتب فيه.
 *
 *  `role` المسمّى الوظيفي الذي عبّأته الإدارة الداعية، لا ما كتبه العضو
 *  عن نفسه. */
export function welcomeParagraphs(opts: {
  fullName: string;
  role: string | null;
  departmentName: string | null;
  colorHex?: string | null;
}): { greeting: string; intro: string; belief: string; aspiration: string; closing: string } {
  const brand = departmentBrand(opts.departmentName, opts.colorHex);
  const as = opts.role?.trim() ? ` بصفتك ${opts.role.trim()}` : "";
  return {
    greeting: `أهلاً وسهلاً، ${opts.fullName}،`,
    intro: `يسعدنا في تَـــلاقِ | TLAQI الترحيب بانضمامك إلى ${brand.copy.phrase}${as}.`,
    belief: brand.copy.belief,
    aspiration: brand.copy.aspiration,
    closing: WELCOME_CLOSING,
  };
}
