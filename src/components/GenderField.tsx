"use client";

import { useTranslations } from "@/i18n/LocaleProvider";

/** اختيار المخاطبة داخل نموذج البيانات — حقلٌ واحد بخيارين.
 *
 *  يُرسَل باسم `gender`، ويُقرأ في الخادم بـ`parseGender` وحده: ما ليس
 *  «male» أو «female» لا يُحفَظ. */
export function GenderField({
  defaultValue,
  required,
}: {
  defaultValue?: "male" | "female" | null;
  required?: boolean;
}) {
  const t = useTranslations().gender;
  return (
    <fieldset className="flex flex-col gap-1.5 text-sm">
      <legend className="mb-1.5 font-medium text-black/70">{t.label}</legend>
      <div className="flex gap-2">
        {(["female", "male"] as const).map((v) => (
          <label
            key={v}
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 text-sm has-[:checked]:border-black/40 has-[:checked]:bg-black/[0.04] has-[:checked]:font-semibold"
          >
            <input
              type="radio"
              name="gender"
              value={v}
              defaultChecked={defaultValue === v}
              required={required}
              className="accent-current"
            />
            {t[v]}
          </label>
        ))}
      </div>
      <span className="text-xs text-black/40">{t.hint}</span>
    </fieldset>
  );
}
