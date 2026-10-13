"use client";

import { useState, useTransition } from "react";
import { setMyDepartmentAction } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** قسمُ المؤسس — يُسجّله مرّةً إذ لم يُسأل عنه يوم أُنشئ حسابه.
 *
 *  والقاعدة التي اختارها لأعضائه تُطبَّق عليه: المصنّف لا يُعاد
 *  تصنيفه. فإن كان مُسجَّلاً فلا نموذج هنا — إيصالٌ يقول قسمه ولِمَ لا
 *  يُبدَّل، لا زرٌّ يُضغط ثم يُرفض. والخادم يفرض الشرط بـ `where`. */
export function MyDepartment({
  departments,
  current,
  theme,
}: {
  departments: { id: string; name: string }[];
  /** قسمه المُسجَّل — null لمن لم يُسجَّل له قسم */
  current: string | null;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [picked, setPicked] = useState("");
  const [saved, setSaved] = useState<string | null>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-bold">قسمك في الهيكل</h2>
      {saved ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">
          ✓ أنت مُسجَّل في <strong>{saved}</strong> — ويظهر في بطاقتك داخل الهيكل. ولا يُعاد
          التسجيل: هي القاعدة نفسها المطبَّقة على الأعضاء.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-black/50">
            حسابك أُنشئ مع المنصة لا بدعوة، فلم يُسأل عن قسمك — وحقلُ القسم في بطاقتك شَرطة.
            سجّله مرّةً واحدة؛ ولا يُعاد التسجيل بعدها.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm">
              <span className="font-medium text-black/70">القسم</span>
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="min-h-11 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              theme={theme}
              disabled={pending || !picked}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await setMyDepartmentAction(picked);
                  if (res.error) {
                    setError(res.error);
                    return;
                  }
                  setSaved(res.departmentName ?? null);
                });
              }}
            >
              {pending ? "يُسجَّل..." : "سجّل قسمي"}
            </Button>
          </div>
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </>
      )}
    </Card>
  );
}
