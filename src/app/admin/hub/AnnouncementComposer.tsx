"use client";

import { useActionState, useState } from "react";
import { publishAnnouncementAction } from "./actions";
import { Button } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";
import type { themeFromColor } from "@/lib/brand";

type Dept = { id: string; name: string };

/** ما يملكه الناشر — يأتي محسوباً من الخادم بنفس الدالة التي تفرضه،
 *  فلا يظهر في النموذج خيارٌ يُرفض عند الإرسال */
export type AnnouncementPowers = {
  audiences: string[];
  lockedDepartmentId: string | null;
  canAttachMeeting: boolean;
};

export function AnnouncementComposer({
  departments,
  theme,
  powers,
}: {
  departments: Dept[];
  theme: ReturnType<typeof themeFromColor>;
  powers: AnnouncementPowers;
}) {
  const dict = useTranslations();
  const t = dict.hub;
  const common = dict.common;
  const [state, formAction, pending] = useActionState(publishAnnouncementAction, {
    error: null,
    success: false,
  });
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState(powers.audiences[0] ?? "everyone");
  const [attachLink, setAttachLink] = useState(false);
  const [handledSuccess, setHandledSuccess] = useState(false);

  // إغلاق النموذج بعد نشر ناجح — يُحسب أثناء الرسم بدل useEffect حتى لا
  // يسبّب رسماً متتالياً (النموذج يُفكّ تلقائياً فلا حاجة لإعادة تصفيره)
  if (state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    if (state.success) {
      setAudience(powers.audiences[0] ?? "everyone");
      setAttachLink(false);
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
        {/* الجمهور لا يُعرض لمن لا يملك إلا واحداً: قائد القسم يُخاطب
            أهله، فإظهار قائمة بخيار واحد سؤالٌ بلا معنى */}
        {powers.audiences.length > 1 ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.audienceLabel}</span>
            <select
              name="audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="min-h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm outline-none focus:border-black/30"
            >
              {powers.audiences.includes("everyone") && (
                <option value="everyone">{t.audienceEveryone}</option>
              )}
              {powers.audiences.includes("leadership") && (
                <option value="leadership">{t.audienceLeadership}</option>
              )}
              {powers.audiences.includes("department") && (
                <option value="department">{t.audienceDepartment}</option>
              )}
            </select>
          </label>
        ) : (
          <input type="hidden" name="audience" value={audience} />
        )}

        {audience === "department" && !powers.lockedDepartmentId && (
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

      {powers.lockedDepartmentId && (
        <p className="-mt-1 text-xs text-black/45">{t.lockedToMyDept}</p>
      )}

      {/* رابط الاجتماع للإدارة العليا وحدها: من يدعو الفريق لاجتماع هو
          من يملك عَقده */}
      {powers.canAttachMeeting && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.meetingLabel}</span>
          <input
            name="meetingUrl"
            type="url"
            dir="ltr"
            placeholder="https://meet.google.com/..."
            className="min-h-11 rounded-xl border border-black/10 px-4 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs leading-relaxed text-black/45">{t.meetingHint}</span>
        </label>
      )}

      {/* الرابط المرفق خيار صريح: أكثر الإعلانات بلا رابط، فلا يُفرض
          حقلٌ فارغ على كل ناشر */}
      <label className="flex items-start gap-2.5 rounded-xl bg-black/[0.03] px-3.5 py-3 text-sm">
        <input
          type="checkbox"
          checked={attachLink}
          onChange={(e) => setAttachLink(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span>
          <span className="font-medium text-black/75">{t.attachLinkLabel}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-black/45">
            {t.attachLinkHint}
          </span>
        </span>
      </label>

      {attachLink && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.linkUrlLabel}</span>
            <input
              name="linkUrl"
              type="url"
              required
              dir="ltr"
              placeholder="https://..."
              className="min-h-11 rounded-xl border border-black/10 px-4 text-sm outline-none focus:border-black/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.linkLabelLabel}</span>
            <input
              name="linkLabel"
              maxLength={60}
              placeholder={t.linkLabelPlaceholder}
              className="min-h-11 rounded-xl border border-black/10 px-4 text-sm outline-none focus:border-black/30"
            />
          </label>
        </div>
      )}

      {/* البريد يصل لمن لا يفتح المنصة اليوم — ولذلك هو اختيار لا افتراض */}
      <label className="flex items-start gap-2.5 rounded-xl bg-black/[0.03] px-3.5 py-3 text-sm">
        <input type="checkbox" name="sendEmail" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium text-black/75">{t.sendEmailLabel}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-black/45">
            {t.sendEmailHint}
          </span>
        </span>
      </label>

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
