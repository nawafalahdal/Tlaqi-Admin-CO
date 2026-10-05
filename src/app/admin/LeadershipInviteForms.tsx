"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createExecutiveInviteAction, createDeptAdminInviteAction } from "./actions";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";
import { Button } from "@/components/ui";
import { InviteLinkReveal } from "@/components/InviteLinkReveal";

type Dept = { id: string; name: string };

const theme = themeFromColor(SUPER_ADMIN_THEME.colorHex);

export function ExecutiveInviteForm() {
  const [state, formAction, pending] = useActionState(createExecutiveInviteAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);

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
        <Field label="الاسم الكامل" name="fullName" placeholder="اسم المرشح للإدارة التنفيذية" />
        <Field label="البريد الإلكتروني" name="email" type="email" placeholder="candidate@email.com" dir="ltr" />
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? "جارِ الإصدار..." : "دعوة لحساب تنفيذي (CEO)"}
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
        <Field label="الاسم الكامل" name="fullName" placeholder="اسم المرشح لقيادة القسم" />
        <Field label="البريد الإلكتروني" name="email" type="email" placeholder="candidate@email.com" dir="ltr" />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">القسم</span>
          <select
            name="departmentId"
            required
            defaultValue=""
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30 bg-white"
          >
            <option value="" disabled>
              اختر القسم
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
          {pending ? "جارِ الإصدار..." : "دعوة لحساب قائد قسم"}
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
        className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
      />
    </label>
  );
}
