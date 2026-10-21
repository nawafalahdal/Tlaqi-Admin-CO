"use client";

import { useActionState, useState } from "react";
import { savePlanIntroAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
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
  const L = useTranslations().rPlansIntro;
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
          <h3 className="text-sm font-bold">{L.centreIntroduction}</h3>
          <p className="mt-1 text-xs leading-relaxed text-black/50">{L.whatEveryoneWhoOpens}</p>
        </div>
        {state.success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{L.theIntroductionWasSaved}</p>
        )}
        <div>
          <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
            {intro.trim() ? L.editTheIntroduction : L.writeTheIntroduction}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{L.centreTitle}</span>
        <input
          name="heading"
          defaultValue={heading}
          maxLength={80}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{L.introduction}</span>
        <textarea
          name="intro"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          maxLength={8000}
          placeholder={L.whatIsTlaqiWhy}
          className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm leading-relaxed outline-none focus:border-black/30"
        />
        <span className="text-xs text-black/45">{fmt(L.of8000Characters, body.length)}</span>
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? L.saving : L.saveTheIntroduction}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>{L.cancel}</Button>
      </div>
    </form>
  );
}
