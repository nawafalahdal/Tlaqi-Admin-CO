"use client";

import { brandInk } from "@/lib/brand";
import { useState, useTransition } from "react";
import { reopenCandidateTestAction } from "../../people/actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

/** مرشّحٌ لم يجتز الاختبار، في لوحة قائد قسمه.
 *
 *  **إعادةُ الدعوة هي إعادةُ فتح الاختبار** (`reopenCandidateTest`): الحسابُ قائمٌ والبريدُ محجوزٌ له، فلا
 *  دعوةَ ثانية تُنشأ. كان الزرُّ يقلب حالةَ الدعوة إلى «مفتوحة» وحدها — وهي حالةٌ لا يقرؤها شيءٌ منذ صارت
 *  الدعوةُ حساباً — فلا يُعاد الاختبار ولا يصل المرشّحَ شيء. والآن: تأكيدُ اجتماع الشرح وملاحظتُه، ثم يُفتح
 *  الاختبارُ من جديد ويصله إشعارٌ بالبريد بمهلة ٢٤ ساعة، ويُغلق طلبُ الاجتماع بنتيجته. */
export function NeedsMeetingRow({
  member,
  theme,
}: {
  member: { id: string; fullName: string; email: string; testScore: number | null };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [pending, startTransition] = useTransition();
  const dict = useTranslations();
  const t = dict.needsMeetingRow;
  const s = dict.stuck;
  const [open, setOpen] = useState(false);
  const [meetingHeld, setMeetingHeld] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reopen() {
    setError(null);
    startTransition(async () => {
      const res = await reopenCandidateTestAction(member.id, meetingHeld, note);
      if (res.error) setError(res.error);
      else setDone(true);
    });
  }

  if (done) {
    return (
      <Card className="p-4">
        <p className="text-sm font-semibold text-emerald-700">{s.reopenDone}</p>
        <p className="mt-1 text-xs text-black/45" dir="ltr">{member.email}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{member.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {member.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-bold" style={{ color: brandInk(theme) }}>
            {t.score}: {member.testScore}%
          </p>
          {!open && (
            <Button theme={theme} variant="outline" onClick={() => setOpen(true)}>
              {t.reopenInvite}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {open && (
        <div className="flex flex-col gap-3 border-t border-black/5 pt-3">
          <p className="text-xs leading-relaxed text-black/50">{s.reopenHint}</p>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={meetingHeld}
              onChange={(e) => setMeetingHeld(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="font-medium text-black/70">{s.meetingHeld}</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={s.notePlaceholder}
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
          <div className="flex flex-wrap gap-2">
            <Button theme={theme} onClick={reopen} disabled={pending || !meetingHeld}>
              {pending ? s.working : s.reopenConfirm}
            </Button>
            <Button theme={theme} variant="outline" onClick={() => setOpen(false)}>
              {dict.common.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
