"use client";

import { useState, useTransition } from "react";
import { assignMemberDepartmentAction } from "@/app/admin/departments/actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

/** تصنيف عضوٍ غير مصنّف في قسم — للمؤسس وحده.
 *
 *  **ولا يُعرَض إلا لغير المصنّف.** ومن صُنِّف لا يُعاد تصنيفه: القسم
 *  ليس وسماً يُبدَّل، ونقلُه بتعديل حقلٍ واحد يُبقي اعتمادَه وتذاكرَه
 *  وشهادتَه معلّقةً بقسمٍ لم يعد فيه.
 *
 *  والخادم يرفض على كل حال — فإخفاءُ الحقل راحةٌ للعين لا حمايةٌ. */
export function AssignDepartment({
  memberId,
  departments,
  theme,
}: {
  memberId: string;
  departments: { id: string; name: string }[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [open, setOpen] = useState(false);
  const [deptId, setDeptId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  if (done) {
    return (
      <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">
        {done}
      </p>
    );
  }

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        {t.deptAdmin.assignButton}
      </Button>
    );
  }

  return (
    <div className="mt-3 flex w-full flex-col gap-3 border-t border-black/5 pt-3">
      <p className="text-xs leading-relaxed text-black/50">{t.deptAdmin.assignHint}</p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.deptAdmin.assignLabel}</span>
        <select
          value={deptId}
          onChange={(e) => setDeptId(e.target.value)}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        >
          <option value="">—</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm font-semibold leading-relaxed text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          theme={theme}
          disabled={pending || !deptId}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await assignMemberDepartmentAction(memberId, deptId);
              if (res.error) setError(res.error);
              else setDone(`${t.deptAdmin.assignDone} ${res.departmentName}`);
            });
          }}
        >
          {pending ? t.actions.working : t.deptAdmin.assignConfirm}
        </Button>
        <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}
