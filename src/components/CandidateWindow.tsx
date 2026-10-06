"use client";

import { useTranslations } from "@/i18n/LocaleProvider";

/** عدّاد مهلة الحساب الجديد كما يراه من أنشأه: كم بقي قبل سقوطه، أو أنه
 *  سقط، أو أن صاحبه دخل فعلاً. بدون هذا العرض تصبح الحوكمة عقوبة مفاجئة
 *  بدل قاعدة معلومة.
 *
 *  الحالات التي لا تنطبق عليها المهلة تُعرَض بشرطة لا بـ"سقطت": الحساب
 *  المعتمد تجاوز المرحلة أصلاً، والحسابات التي أُنشئت قبل هذه القاعدة لا
 *  تاريخ إصدار لها فلا يصح الحكم عليها بأثر رجعي. */
export function CandidateWindow({
  firstLoginAt,
  hoursLeft,
  lapsed,
  notApplicable,
}: {
  firstLoginAt: string | null;
  /** موجب = باقٍ من المهلة */
  hoursLeft: number | null;
  /** أُسقط فعلاً بسبب انقضاء المهلة تحديداً */
  lapsed: boolean;
  notApplicable: boolean;
}) {
  const t = useTranslations().candidateWindow;

  if (lapsed) return <span className="text-xs font-semibold text-red-700">{t.lapsed}</span>;
  if (firstLoginAt) return <span className="text-xs font-semibold text-green-700">{t.signedIn}</span>;
  if (notApplicable || hoursLeft === null) return <span className="text-xs text-black/30">—</span>;

  const urgent = hoursLeft <= 6;
  return (
    <span
      className={`text-xs font-semibold ${urgent ? "text-red-700" : "text-amber-700"}`}
      title={t.windowExplainer}
    >
      {t.hoursLeft.replace("{h}", String(Math.max(hoursLeft, 0)))}
    </span>
  );
}
