"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "tlaqi:navDepth";

/** صفحاتُ البوّابة لا تُعدّ خطوةً يُرجَع إليها.
 *
 *  من سجّل دخوله وصل إلى لوحته عبر `/login`، فيبقى في التاريخ خلفه.
 *  والرجوع إليها طريقٌ مسدود: هو داخلٌ بالفعل، فإمّا تُعيده إلى لوحته
 *  فورَ فتحها أو تَعرض له نموذجاً لا يحتاجه. فلا تُحسَب، ويصعد الزرُّ
 *  من فوقها إلى وجهته الصريحة.
 *
 *  والمطابقة على أول مقطعٍ من المسار لا على النصّ كلِّه: `/invite/<رمز>`
 *  و`/reset-password/<رمز>` لهما ذيولٌ متغيّرة. */
const GATE_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/change-password",
  "/invite",
];

function isGate(pathname: string): boolean {
  return GATE_PREFIXES.some((g) => pathname === g || pathname.startsWith(g + "/"));
}

/** عدّاد خطوات التنقّل **داخل** المنصة.
 *
 *  `window.history.length` لا يصلح لهذا: هو طولُ تاريخ التبويب كلِّه —
 *  ومنه ما زاره المستخدم قبل أن يدخل المنصة. فمن فتح `/admin/accounts`
 *  من رابطٍ في بريده، وكان في التبويب نفسه قد تصفّح موقعاً آخر، يكون
 *  `history.length > 1` صحيحاً، فيُنادى `router.back()` فيعود إلى ذلك
 *  الموقع — أي يخرج من المنصة. وهذا ما وقع فعلاً.
 *
 *  فصار العدّ عدَّنا: كلّ تبدّلٍ للمسار داخل المنصة يزيد العدّاد في
 *  `sessionStorage`. وزرّ الرجوع لا يُنادي `back()` إلا والعدّاد يشهد أن
 *  خلفه خطوةً من خطواتنا؛ وإلا صعد إلى الوجهة الصريحة.
 *
 *  و`sessionStorage` يُمحى بإغلاق التبويب، فلا يُورَّث عدٌّ لجلسةٍ أخرى.
 *  وهو لا يُقرأ ولا يُكتب إلا داخل `try`: التبويب الخاصّ قد يمنعه.
 */
export function NavDepth() {
  const pathname = usePathname();

  useEffect(() => {
    if (isGate(pathname)) return;
    try {
      const raw = sessionStorage.getItem(KEY);
      const n = raw === null ? 0 : Number(raw);
      sessionStorage.setItem(KEY, String(Number.isFinite(n) ? n + 1 : 1));
    } catch {
      // تخزين الجلسة محجوب — فيرتدّ زرُّ الرجوع إلى وجهته الصريحة
    }
  }, [pathname]);

  return null;
}

/** هل خلفنا صفحةٌ من صفحات المنصة؟
 *
 *  العدّاد يبدأ عند ١ لأول صفحة، فوجودُ خطوةٍ خلفنا يعني أنه بلغ ٢. */
export function hasInAppHistory(): boolean {
  try {
    const n = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(n) && n > 1;
  } catch {
    return false;
  }
}

/** يُنقص العدّاد عند الرجوع، فلا يُحسَب الرجوعُ تقدّماً.
 *
 *  بدونه: ذهابٌ ورجوعٌ متكرّران يرفعان العدّاد بلا حدّ، فيظنّ الزرُّ أن
 *  خلفه خطواتٍ وقد استُهلكت كلُّها. */
export function consumeInAppStep() {
  try {
    const n = Number(sessionStorage.getItem(KEY));
    // يُطرَح اثنان: خطوةُ الرجوع نفسها ستُحسَب تقدّماً في `useEffect`
    if (Number.isFinite(n)) sessionStorage.setItem(KEY, String(Math.max(0, n - 2)));
  } catch {
    /* محجوب */
  }
}
