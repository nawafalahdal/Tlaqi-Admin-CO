"use client";

import { useActionState, useState } from "react";
import { publishAnnouncementAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

type Dept = { id: string; name: string };

export function AnnouncementComposer({
  departments,
  theme,
}: {
  departments: Dept[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const dict = useTranslations();
  const t = dict.hub;
  const common = dict.common;
  const [state, formAction, pending] = useActionState(publishAnnouncementAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState("everyone");
  const [handledSuccess, setHandledSuccess] = useState(false);

  // إغلاق النموذج بعد نشر ناجح — يُحسب أثناء الرسم بدل useEffect حتى لا
  // يسبّب رسماً متتالياً (النموذج يُفكّ تلقائياً فلا حاجة لإعادة تصفيره)
  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) {
      setAudience("everyone");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
        {t.newAnnouncement}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.annTitleLabel}</span>
        <input
          name="title"
          required
          maxLength={120}
          placeholder={t.annTitlePlaceholder}
          className="min-h-11 rounded-xl border border-black/10 px-4 text-sm outline-none focus:border-black/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">{t.annBodyLabel}</span>
        <textarea
          name="body"
          required
          rows={4}
          maxLength={2000}
          placeholder={t.annBodyPlaceholder}
          className="rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-black/30"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.audienceLabel}</span>
          <select
            name="audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
          >
            <option value="everyone">{t.audienceEveryone}</option>
            <option value="leadership">{t.audienceLeadership}</option>
            <option value="department">{t.audienceDepartment}</option>
          </select>
        </label>

        {audience === "department" && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.deptLabel}</span>
            <select
              name="departmentId"
              required
              defaultValue=""
              className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
            >
              <option value="" disabled>
                {t.deptPlaceholder}
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? t.publishing : t.publish}
        </Button>
        <Button type="button" theme={theme} variant="ghost" onClick={() => setOpen(false)}>
          {common.cancel}
        </Button>
      </div>
    </form>
  );
}
