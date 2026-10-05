"use client";

import { useActionState, useRef, useEffect } from "react";
import { createMemberInviteAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

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

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="departmentId" value={departmentId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">الاسم الكامل</span>
          <input
            name="fullName"
            required
            placeholder="اسم المرشح"
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">البريد الإلكتروني</span>
          <input
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder="candidate@email.com"
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">المسمى الوظيفي</span>
          <input
            name="jobTitle"
            placeholder="مثال: أخصائي محتوى"
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          تم إصدار دعوة العضو وإرسالها بنجاح
        </p>
      )}

      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? "جارِ الإصدار..." : "دعوة عضو جديد"}
        </Button>
      </div>
    </form>
  );
}
