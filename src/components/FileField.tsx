"use client";

import { useEffect, useId, useState, type ChangeEvent, type Ref } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";

const CLEARED = "tlaqi:file-cleared";

/** يُفرغ الحقلَ من الشيفرة (بعد رفعٍ ناجح مثلاً) ويُعلم الحقلَ ليمحو الاسم.
 *  وحدثٌ خاصٌّ لا `change`: الأخيرُ يُشغّل `onChange` النموذج فيمحو رسالةَ
 *  النجاح التي كُتبت للتوّ. */
export function clearFileField(input: HTMLInputElement | null) {
  if (!input) return;
  input.value = "";
  input.dispatchEvent(new Event(CLEARED));
}

/** حقلُ ملفٍّ واحدٌ للمنصة كلها.
 *
 *  كان كلُّ نموذجٍ يرسم `<input type="file">` كما يرسمه المتصفّح: زرٌّ
 *  رماديٌّ بلغة المتصفّح («Choose File / No file chosen») وسط صفحةٍ
 *  عربية، وبأربعة أشكالٍ في أربع صفحات.
 *
 *  والآن الحقلُ الأصليُّ نفسُه باقٍ — هو ما يحمل الملفَّ إلى النموذج،
 *  ويُركَّز عليه بلوحة المفاتيح، ويقرؤه قارئُ الشاشة — مكسوّاً بزرٍّ
 *  بلغة الصفحة واسمِ الملف المختار. فلا يتغيّر في النماذج اسمٌ ولا
 *  إجراءُ خادم. */
export function FileField({
  name,
  accept,
  disabled,
  onChange,
  inputRef,
  describedBy,
}: {
  name?: string;
  accept?: string;
  disabled?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** معرّفُ نصّ الشرح تحت الحقل (الأنواعُ والحجم) */
  describedBy?: string;
}) {
  const t = useTranslations().common;
  const id = useId();
  const [picked, setPicked] = useState<string | null>(null);
  // يُمحى الاسمُ حين يُفرَغ الحقل: بإعادة ضبط النموذج بعد إرسالٍ ناجح، أو
  // بـ`clearFileField` — وإلا بقي اسمُ ملفٍّ لم يَعُد مختاراً
  useEffect(() => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    const clear = () => setPicked(null);
    const form = el.form;
    el.addEventListener(CLEARED, clear);
    form?.addEventListener("reset", clear);
    return () => {
      el.removeEventListener(CLEARED, clear);
      form?.removeEventListener("reset", clear);
    };
  }, [id]);

  return (
    <div className="file-field" data-disabled={disabled ? "true" : undefined}>
      <input
        id={id}
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy}
        className="file-field__input"
        onChange={(e) => {
          setPicked(e.target.files?.[0]?.name ?? null);
          onChange?.(e);
        }}
      />
      <label htmlFor={id} className="file-field__button">
        {t.fileChoose}
      </label>
      <span className="file-field__name" aria-live="polite">
        {picked ?? t.fileNone}
      </span>
    </div>
  );
}
