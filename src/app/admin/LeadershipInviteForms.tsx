"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createExecutiveInviteAction, createDeptAdminInviteAction, createOperationsOfficerInviteAction } from "./actions";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { Button } from "@/components/ui";
import { InviteLinkReveal } from "@/components/InviteLinkReveal";
import { useTranslations } from "@/i18n/LocaleProvider";

type Dept = { id: string; name: string };

const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

export function ExecutiveInviteForm() {
  const [state, formAction, pending] = useActionState(createExecutiveInviteAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const t = useTranslations();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  if (state.success && state.inviteUrl && state.inviteUrl !== dismissedUrl) {
    return (
      <InviteLinkReveal
        inviteUrl={state.inviteUrl}
        theme={theme}
        onClose={() => setDismissedUrl(state.inviteUrl!)}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.leadershipInvite.fullName} name="fullName" placeholder={t.leadershipInvite.execFullNamePlaceholder} />
        <Field label={t.leadershipInvite.email} name="email" type="email" placeholder="candidate@email.com" dir="ltr" />
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? t.leadershipInvite.submitting : t.leadershipInvite.execSubmit}
        </Button>
      </div>
    </form>
  );
}

export function DeptAdminInviteForm({ departments }: { departments: Dept[] }) {
  const [state, formAction, pending] = useActionState(createDeptAdminInviteAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const t = useTranslations();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  if (state.success && state.inviteUrl && state.inviteUrl !== dismissedUrl) {
    return (
      <InviteLinkReveal
        inviteUrl={state.inviteUrl}
        theme={theme}
        onClose={() => setDismissedUrl(state.inviteUrl!)}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t.leadershipInvite.fullName} name="fullName" placeholder={t.leadershipInvite.leadFullNamePlaceholder} />
        <Field label={t.leadershipInvite.email} name="email" type="email" placeholder="candidate@email.com" dir="ltr" />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.leadershipInvite.department}</span>
          <select
            name="departmentId"
            required
            defaultValue=""
            className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30 bg-white"
          >
            <option value="" disabled>
              {t.leadershipInvite.departmentPlaceholder}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? t.leadershipInvite.submitting : t.leadershipInvite.leadSubmit}
        </Button>
      </div>
    </form>
  );
}

export function OperationsOfficerInviteForm() {
  const [state, formAction, pending] = useActionState(createOperationsOfficerInviteAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const t = useTranslations();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  if (state.success && state.inviteUrl && state.inviteUrl !== dismissedUrl) {
    return (
      <InviteLinkReveal
        inviteUrl={state.inviteUrl}
        theme={theme}
        onClose={() => setDismissedUrl(state.inviteUrl!)}
      />
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t.opsExtras.fullNameLabel}
          name="fullName"
          placeholder={t.opsExtras.opsFullNamePlaceholder}
        />
        <Field
          label={t.opsExtras.emailLabel}
          name="email"
          type="email"
          placeholder="candidate@email.com"
          dir="ltr"
        />
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? t.actions.issuing : t.actions.inviteOpsAccount}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  dir,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-black/70">{label}</span>
      <input
        name={name}
        type={type}
        required
        placeholder={placeholder}
        dir={dir}
        className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
      />
    </label>
  );
}
