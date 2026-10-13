"use client";

import { useState, useTransition } from "react";
import { deleteDepartmentAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

/** حذف قسم — للمؤسس وحده، ولا يقع إلا باسمه مكتوباً.
 *
 *  والرفضُ هنا مُفيدٌ لا مُحبِط: الخادم يُسمّي ما يمنع الحذف بعدده
 *  («٣ سجلّات عضوية، تذكرة واحدة»)، فيعرف المؤسس ما يُفرّغه قبل أن
 *  يُعيد المحاولة. */
export function DeleteDepartment({
  departmentId,
  departmentName,
  theme,
}: {
  departmentId: string;
  departmentName: string;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setName("");
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center rounded-xl bg-red-50 px-4 text-sm font-semibold text-red-800 ring-1 ring-red-300"
      >
        {t.deptAdmin.deleteButton}
      </button>
    );
  }

  return (
    <div className="mt-3 flex w-full flex-col gap-3 rounded-2xl bg-red-50/70 p-4 ring-1 ring-red-200">
      <p className="text-xs font-bold text-red-900">{t.deptAdmin.deleteTitle}</p>
      <p className="text-xs leading-relaxed text-red-900/80">{t.deptAdmin.deleteHint}</p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.deptAdmin.deleteConfirmName}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={departmentName}
          className="min-h-11 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
        />
      </label>
      {error && <p className="text-sm font-semibold leading-relaxed text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await deleteDepartmentAction(departmentId, name);
              if (res.error) setError(res.error);
              else setOpen(false);
            });
          }}
          className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? t.actions.working : t.deptAdmin.deleteConfirm}
        </button>
        <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}
