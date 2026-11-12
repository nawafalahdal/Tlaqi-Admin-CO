"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptInviteAction } from "../../actions";

/** نموذجُ القبول — كلمةُ مرورٍ لمدعوٍّ جديد، أو دخولٌ بالحساب القائم ثم القبول. والقرارُ في الخادم. */
export function AcceptForm({ token, needsPassword, signedIn }: { token: string; needsPassword: boolean; signedIn: boolean }) {
  const [state, action, pending] = useActionState(acceptInviteAction, { error: null, success: false });
  const back = `/login?callbackUrl=${encodeURIComponent(`/senior/invite/${token}`)}`;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {needsPassword ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">اختر كلمة مرور لحسابك</span>
          <input
            type="password"
            name="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2 text-sm outline-none focus:border-black/30"
          />
          <span className="text-xs text-black/45">عشرة أحرفٍ على الأقل، تجمع حروفاً وأرقاماً.</span>
        </label>
      ) : (
        !signedIn && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            لهذا البريد حسابٌ في المنصة — <Link href={back} className="font-semibold underline">سجّل الدخول به</Link> ثم افتح الرابط مرّةً أخرى.
          </p>
        )
      )}
      <button type="submit" disabled={pending} className="btn-brand inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold disabled:opacity-50">
        {pending ? "يُقبَل…" : "قبول الدعوة"}
      </button>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
          {/لهذا البريد حسابٌ/.test(state.error) && (
            <>
              {" "}
              <Link href={back} className="font-semibold underline">تسجيل الدخول</Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
