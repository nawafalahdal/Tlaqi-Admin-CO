"use client";

import { useActionState } from "react";
import { changePasswordAction } from "./actions";
import { BRAND } from "@/lib/brand";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">
          {forced ? "كلمة المرور المؤقتة" : "كلمة المرور الحالية"}
        </span>
        <input
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">كلمة المرور الجديدة</span>
        <input
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">تأكيد كلمة المرور الجديدة</span>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15"
        />
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: BRAND.temptress }}
      >
        {pending ? "جارِ الحفظ..." : "حفظ كلمة المرور والدخول مجدداً"}
      </button>
    </form>
  );
}
