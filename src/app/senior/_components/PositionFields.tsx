import type { SeniorCapability } from "@prisma/client";
import { SENIOR_CAPABILITIES } from "@/lib/governance/senior";
import { Field, inputCls, textareaCls } from "../../committees/_components/bits";

/** حقولُ التكليف — المسمّى حرٌّ (عربيٌّ وإنجليزيٌّ اختياري)، والصلاحياتُ من القائمة المعتمدة وحدها.
 *  تُرسم في الخادم، وتُستعمل في الدعوة الجديدة وفي تعديل التكليف. */
export function PositionFields({
  defaults,
}: {
  defaults?: {
    titleAr?: string;
    titleEn?: string | null;
    description?: string | null;
    responsibilities?: string | null;
    capabilities?: SeniorCapability[];
    startDate?: Date | null;
    notes?: string | null;
  };
}) {
  const caps = new Set(defaults?.capabilities ?? ["board_view"]);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المسمّى الإداري (عربي)" required hint="حرّ — مثل: المستشار القانوني، المتحدث الرسمي">
          <input name="titleAr" required minLength={2} maxLength={80} defaultValue={defaults?.titleAr ?? ""} className={inputCls} />
        </Field>
        <Field label="المسمّى بالإنجليزية (اختياري)">
          <input name="titleEn" maxLength={80} dir="ltr" defaultValue={defaults?.titleEn ?? ""} className={inputCls} />
        </Field>
      </div>
      <Field label="الوصف">
        <textarea name="description" maxLength={600} defaultValue={defaults?.description ?? ""} className={textareaCls} />
      </Field>
      <Field label="المسؤوليات" hint="سطرٌ لكل مسؤولية">
        <textarea name="responsibilities" maxLength={1500} defaultValue={defaults?.responsibilities ?? ""} className={textareaCls} />
      </Field>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium text-black/70">الصلاحيات</legend>
        <p className="text-xs leading-relaxed text-black/45">
          صلاحياتٌ محدّدة لا تشمل القيادة: لا يدعو صاحبُها أحداً ولا يعيّن ولا يغيّر صلاحيات غيره.
        </p>
        {SENIOR_CAPABILITIES.map((c) => (
          <label key={c.key} className="flex min-h-10 items-start gap-2.5 rounded-lg px-1 py-1.5">
            <input
              type="checkbox"
              name="capabilities"
              value={c.key}
              defaultChecked={caps.has(c.key)}
              // لوحةُ الإدارة لكل تكليفٍ دائماً — تُرسَل معه ولو لم تُعلَّم
              disabled={c.key === "board_view"}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              <span className="font-semibold">{c.label}</span>
              <span className="block text-xs text-black/50">{c.can}</span>
            </span>
          </label>
        ))}
        <input type="hidden" name="capabilities" value="board_view" />
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="تاريخ البدء">
          <input type="date" name="startDate" defaultValue={defaults?.startDate ? defaults.startDate.toISOString().slice(0, 10) : ""} className={inputCls} />
        </Field>
        <Field label="ملاحظات">
          <input name="notes" maxLength={600} defaultValue={defaults?.notes ?? ""} className={inputCls} />
        </Field>
      </div>
    </>
  );
}
