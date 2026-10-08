"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createMemberInviteAction } from "./actions";
import { Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function MemberInviteForm({
  departmentId,
  theme,
}: {
  departmentId: string;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [state, formAction, pending] = useActionState(createMemberInviteAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const t = useTranslations();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  // تُعرض بيانات الدخول مرة واحدة فقط بعد الإنشاء — لم تعد رابطاً مجهولاً
  // بل بريداً وكلمة مرور مؤقتة يسلّمهما المسؤول مباشرة للمرشّح
  if (state.success && state.credentials && state.credentials.tempPassword !== dismissed) {
    return (
      <CredentialsReveal
        email={state.credentials.email}
        tempPassword={state.credentials.tempPassword}
        theme={theme}
        onClose={() => setDismissed(state.credentials!.tempPassword)}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="departmentId" value={departmentId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.memberInviteForm.fullName}</span>
          <input
            name="fullName"
            required
            placeholder={t.memberInviteForm.fullNamePlaceholder}
            className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.memberInviteForm.email}</span>
          <input
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder="candidate@email.com"
            className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.memberInviteForm.jobTitle}</span>
          <input
            name="jobTitle"
            required
            placeholder={t.memberInviteForm.jobTitlePlaceholder}
            className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs leading-relaxed text-black/45">
            {t.leadershipInvite.jobTitleHint}
          </span>
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? t.memberInviteForm.submitting : t.memberInviteForm.submit}
        </Button>
      </div>
    </form>
  );
}
