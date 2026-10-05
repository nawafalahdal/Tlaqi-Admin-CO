"use client";

import { useActionState, useRef, useEffect } from "react";
import { createInviteAction } from "./actions";
import { themeFromColor } from "@/lib/brand";
import { Button } from "@/components/ui";

type Dept = { id: string; name: string; colorHex: string };

export function InviteForm({ departments }: { departments: Dept[] }) {
  const [state, formAction, pending] = useActionState(createInviteAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const theme = themeFromColor("#341D2B");

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
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
            placeholder="candidate@email.com"
            dir="ltr"
            className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">القسم المستهدف</span>
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

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          تم إصدار الدعوة وإرسالها بنجاح
        </p>
      )}

      <div>
        <Button type="submit" theme={theme} disabled={pending}>
          {pending ? "جارِ الإصدار..." : "إصدار الدعوة"}
        </Button>
      </div>
    </form>
  );
}
