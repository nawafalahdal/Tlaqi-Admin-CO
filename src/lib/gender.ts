/** المخاطبة بالجنس الصحيح — في الرسائل والشهادات.
 *
 *  كانت كلّ رسالةٍ بالمذكّر: «قائد قسم» لقائدةٍ، و«أكملتَ» لمن أكملت.
 *  وكان البديلُ المطروح «قائد/ـة» — وهو يقول للقارئة إنّ أحداً لم
 *  يعرفها. فصار لكلّ شخصٍ جنسٌ يختاره بنفسه (`Gender` في المخطّط)، وكلُّ
 *  صيغةٍ تُكتب مرّتين هنا وتُختار به.
 *
 *  **ومن لم يختر لا يُخمَّن جنسُه من اسمه** — التخمين يُخطئ ويُسيء.
 *  فإن وُجدت صيغةٌ محايدة سليمة كُتبت له، وإلا فالمذكّر الذي جرى به
 *  عُرف المخاطبة العامة في العربية. */

import { getDictionary, type Locale } from "@/i18n";

export type Gender = "male" | "female";
export type MaybeGender = Gender | null | undefined;

/** يختار الصيغة: المؤنّثة لمن اختار الأنثى، والمحايدة (إن كُتبت) لمن لم
 *  يختر، والمذكّرة فيما عدا ذلك. */
export function gx(g: MaybeGender, male: string, female: string, neutral?: string): string {
  if (g === "female") return female;
  if (g === "male") return male;
  return neutral ?? male;
}

/** يقبل ما يأتي من القاعدة أو النموذج، ويرفض ما سواه */
export function parseGender(value: unknown): Gender | null {
  return value === "male" || value === "female" ? value : null;
}

/** مسمّى الدور كما يُكتب عن صاحبه — بجنسه.
 *
 *  المسمّيات نفسها هي مسمّيات المنصة (`shell.roles`)، لا تُغيَّر؛ وإنما
 *  تُصرَّف. و`departmentName` يُلحَق بالقائد: «قائدة قسم التسويق». */
export function roleTitle(role: string, g: MaybeGender, departmentName?: string | null, locale: Locale = "ar"): string {
  const dept = departmentName?.trim();
  // المسمّى الإنجليزيّ لا يُصرَّف بالجنس، والقسمُ يُلحَق باسمه كما هو
  if (locale === "en") {
    const roles = getDictionary("en").shell.roles as Record<string, string>;
    if (role === "department_admin" && dept) return `${roles.department_admin} · ${dept}`;
    return roles[role] ?? role;
  }
  switch (role) {
    case "super_admin":
      return gx(g, "المؤسس", "المؤسِّسة");
    case "executive":
      return gx(g, "الرئيس التنفيذي", "الرئيسة التنفيذية");
    case "operations_officer":
      return gx(g, "مسؤول المتابعة والتشغيل", "مسؤولة المتابعة والتشغيل");
    case "department_admin": {
      const base = gx(g, "قائد", "قائدة");
      if (!dept) return `${base} قسم`;
      return /^(قسم|إدارة|فريق|وحدة|لجنة)\s/.test(dept) || dept === "الإدارة العليا"
        ? `${base} ${dept}`
        : `${base} قسم ${dept}`;
    }
    case "member":
      return gx(g, "عضو", "عضوة");
    default:
      return role;
  }
}

/** ما يتكرّر في الرسائل من أفعالٍ وضمائر — مكتوبٌ مرّةً ليُقرأ واحداً */
export function forms(g: MaybeGender) {
  return {
    /** أهلاً بك / بكِ */
    you: gx(g, "بك", "بكِ"),
    /** لك / لكِ */
    toYou: gx(g, "لك", "لكِ"),
    /** شكراً لك / لكِ */
    thanks: gx(g, "شكراً لك", "شكراً لكِ"),
    /** انضممتَ / انضممتِ */
    joined: gx(g, "انضممتَ", "انضممتِ", "انضممت"),
    /** أحسنتَ / أحسنتِ */
    wellDone: gx(g, "أحسنتَ", "أحسنتِ", "أحسنت"),
    /** عزيزي / عزيزتي — لا تُكتب لمن لم يختر */
    dear: gx(g, "عزيزي", "عزيزتي", ""),
    /** هو / هي — ضمير الغائب في الشهادة */
    his: gx(g, "ه", "ها"),
  };
}

/** الموقع بصيغة المصدر — لا يحتاج جنساً، فيصحّ قبل أن يختار صاحبه.
 *
 *  الدعوة تصل قبل أن يُسجِّل المدعوّ شيئاً، فلا يُعرف جنسه بعد. و«قائد
 *  قسم» تُخطئ نصفَ المدعوّين، و«قائد/ـة» تقول إنّ أحداً لم يعرفهم.
 *  فيُسمّى الموقع لا صاحبه: «قيادة قسم التقنية»، «عضوية قسم التسويق». */
export function positionTitle(role: string, departmentName?: string | null): string {
  const dept = departmentName?.trim();
  const inDept = dept
    ? /^(قسم|إدارة|فريق|وحدة|لجنة)\s/.test(dept) || dept === "الإدارة العليا"
      ? dept
      : `قسم ${dept}`
    : null;
  switch (role) {
    case "super_admin":
      return "التأسيس";
    case "executive":
      return "الرئاسة التنفيذية";
    case "operations_officer":
      return "المتابعة والتشغيل";
    case "department_admin":
      return inDept ? `قيادة ${inDept}` : "قيادة قسم";
    case "member":
      return inDept ? `عضوية ${inDept}` : "عضوية فريق تَـــلاقِ";
    default:
      return role;
  }
}
