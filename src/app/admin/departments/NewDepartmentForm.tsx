"use client";

import { useActionState, useState } from "react";
import { createDepartmentAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

/** ألوان مقترحة من هوية تَـــلاقِ وما يجاورها — والحقل يقبل أي لون غيرها */
const SWATCHES = [
  "#C34900",
  "#341D2B",
  "#67C090",
  "#1F6F8B",
  "#B38B2D",
  "#7A4EAB",
  "#C2185B",
  "#3F7D20",
];

export function NewDepartmentForm({ theme }: { theme: ReturnType<typeof themeFromColor> }) {
  const dict = useTranslations();
  const t = dict.deptAdmin;
  const [state, formAction, pending] = useActionState(createDepartmentAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(SWATCHES[0]);
  const [handledSuccess, setHandledSuccess] = useState(false);
  const [leadershipOnly, setLeadershipOnly] = useState(false);

  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) {
      setOpen(false);
      setLeadershipOnly(false);
    }
  }

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        {t.newTitle}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.nameLabel}</span>
        <input
          name="name"
          required
          maxLength={60}
          placeholder={t.namePlaceholder}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
        />
      </label>

      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium text-black/70">{t.colorLabel}</span>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              className={`h-10 w-10 rounded-full border-2 transition-transform ${
                color === c ? "scale-110 border-black/60" : "border-black/10"
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-black/10 bg-white p-1"
          />
          <input
            name="colorHex"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            dir="ltr"
            pattern="#[0-9a-fA-F]{6}"
            required
            className="min-h-11 w-32 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          />
        </div>
      </div>

      {/* معاينة فورية: اللون يصبح هوية لوحة القسم كاملةً، فيُرى قبل الحفظ */}
      <div
        className="rounded-2xl px-4 py-3 text-sm font-bold"
        style={{ background: color, color: "#fff" }}
      >
        {t.preview}
      </div>

      {/* القسم الاستثنائي: ممثل قانوني أو مستشار أو جهة خارجية تتبع
          الإدارة العليا. ليس فريق عملٍ يُدار بتذاكر القسم وإعلاناته. */}
      <label className="flex items-start gap-2.5 rounded-xl bg-black/[0.03] px-3.5 py-3 text-sm">
        <input
          type="checkbox"
          name="leadershipOnly"
          checked={leadershipOnly}
          onChange={(e) => setLeadershipOnly(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span>
          <span className="font-medium text-black/75">{t.leadershipOnlyLabel}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-black/45">
            {t.leadershipOnlyHint}
          </span>
        </span>
      </label>

      <p className="text-xs leading-relaxed text-black/45">
        {leadershipOnly ? t.trackNoteExceptional : t.trackNote}
      </p>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? t.creating : t.createSubmit}
        </Button>
        <Button theme={theme} variant="outline" type="button" onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </form>
  );
}
