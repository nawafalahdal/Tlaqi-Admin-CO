"use client";

import { useActionState, useState } from "react";
import { savePlanIntroAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** تحريرُ النبذة والعنوان — للمؤسس والمدير التنفيذي.
 *
 *  والنصُّ يُعرَض فقراتٍ كما يُكتب: السطرُ الفارغ يفصل فقرة. ولا
 *  Markdown ولا HTML — النصُّ يُعرَض نصّاً، فلا يَحمل مُدخَلٌ من أحدٍ
 *  وسماً يُنفَّذ في صفحةٍ يراها الجميع. */
export function PlanIntroEditor({
  heading,
  intro,
  theme,
}: {
  heading: string;
  intro: string;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(savePlanIntroAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(intro);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-bold">نبذة المركز</h3>
          <p className="mt-1 text-xs leading-relaxed text-black/50">
            ما يقرؤه كلُّ من يفتح الصفحة قبل الملفّات: من نحن، ولماذا، وكيف. والسطرُ الفارغ يفصل
            فقرةً عن فقرة.
          </p>
        </div>
        {state.success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            حُفظت النبذة — وتُقرأ الآن أعلى الصفحة.
          </p>
        )}
        <div>
          <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
            {intro.trim() ? "حرّر النبذة" : "اكتب النبذة"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">عنوان المركز</span>
        <input
          name="heading"
          defaultValue={heading}
          maxLength={80}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">النبذة</span>
        <textarea
          name="intro"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          maxLength={8000}
          placeholder={"ما هي تَـــلاقِ؟\n\nلماذا وُجدت، وما الذي نريد أن نصل إليه؟\n\nكيف نعمل؟"}
          className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm leading-relaxed outline-none focus:border-black/30"
        />
        <span className="text-xs text-black/45">{body.length} من ٨٠٠٠ حرف</span>
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ..." : "احفظ النبذة"}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
