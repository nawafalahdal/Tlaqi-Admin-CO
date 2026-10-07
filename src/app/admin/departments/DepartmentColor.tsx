"use client";

import { useState, useTransition } from "react";
import { updateDepartmentColorAction } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";

const SWATCHES = ["#C34900", "#341D2B", "#67C090", "#1F6F8B", "#B38B2D", "#7A4EAB", "#C2185B", "#3F7D20"];

/** تغيير لون قسم من فهرس الأقسام — في مكانه الصحيح الآن.
 *  كان داخل لوحة القسم، ولوحة القسم ما عادت تُفتح لمن يملك الهيكل. */
export function DepartmentColor({
  departmentId,
  current,
}: {
  departmentId: string;
  current: string;
}) {
  const dict = useTranslations();
  const t = dict.deptAdmin;
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-black/60 hover:bg-black/[0.03]"
      >
        {t.changeColor}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={c}
            className={`h-8 w-8 rounded-full border-2 ${color === c ? "scale-110 border-black/60" : "border-black/10"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-black/10 bg-white p-0.5"
        />
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateDepartmentColorAction(departmentId, color);
              if (res.error) setError(res.error);
              else setOpen(false);
            })
          }
          className="min-h-9 rounded-lg bg-[#341D2B] px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? t.creating : t.saveColor}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-9 rounded-lg border border-black/10 px-3 text-xs font-semibold text-black/55"
        >
          {dict.common.cancel}
        </button>
      </div>
    </div>
  );
}
