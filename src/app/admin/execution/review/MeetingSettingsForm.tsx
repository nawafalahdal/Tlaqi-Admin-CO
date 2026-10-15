"use client";

import { useActionState } from "react";
import { saveMeetingSettingsAction } from "../actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import type { MeetingSettings } from "@/lib/reviewMeeting";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** إعداداتُ الاجتماع — ولا ساعةَ مكتوبةٌ في الكود.
 *
 *  اليومُ والساعةُ والمدّةُ والرابط تُضبَط من هنا فتُطبَّق على كل
 *  اجتماعٍ يُنشَأ بعدها. والمنطقةُ الزمنيةُ الرياض دائماً: المنظمةُ
 *  واحدةٌ ومكانُها واحد، وجعلُها خياراً يَفتح باب خطأٍ لا حاجة إليه. */
export function MeetingSettingsForm({
  settings,
  theme,
}: {
  settings: MeetingSettings;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(saveMeetingSettingsAction, {
    error: null,
    success: false,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-black/50">
        بتوقيت الرياض — ويُطبَّق على الاجتماعات التي تُنشَأ بعد الحفظ. والاجتماعُ لا يتكرّر
        لأسبوعٍ واحد مهما أُعيد الحساب.
      </p>
      <div className="grid gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">اليوم</span>
          <select
            name="weekday"
            defaultValue={settings.weekday}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          >
            {DAYS.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الساعة</span>
          <input
            name="hour"
            type="number"
            min={0}
            max={23}
            defaultValue={settings.hour}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الدقيقة</span>
          <input
            name="minute"
            type="number"
            min={0}
            max={59}
            defaultValue={settings.minute}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">المدّة (دقيقة)</span>
          <input
            name="durationMinutes"
            type="number"
            min={15}
            max={480}
            defaultValue={settings.durationMinutes}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">المُنظِّم</span>
          <input
            name="organizerName"
            defaultValue={settings.organizerName ?? ""}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">مكانُه أو رابطُه</span>
          <input
            name="locationOrUrl"
            dir="ltr"
            defaultValue={settings.locationOrUrl ?? ""}
            placeholder="https://meet..."
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
          />
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.success && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          حُفظت الإعدادات — وتُطبَّق على الاجتماعات الجديدة.
        </p>
      )}

      <div>
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ..." : "احفظ الإعدادات"}
        </Button>
      </div>
    </form>
  );
}
