"use client";

import { useActionState, useState } from "react";
import { loginAction, requestLoginCodeAction, type LoginStep1 } from "./actions";
import { BRAND } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

const FIELD =
  "min-h-11 rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15";

/** الدخول على خطوتين: كلمة المرور أولاً، ثم رمز يصل إلى البريد.
 *
 *  الخطوتان في مكوّن واحد لا صفحتين: الانتقال لصفحة أخرى يعني حمل كلمة
 *  المرور في الرابط أو في الجلسة قبل اكتمال الدخول، وكلاهما أسوأ من
 *  إبقائها في الذاكرة لحظات. */
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations();
  const [creds, setCreds] = useState({ email: "", password: "" });

  const [step1, requestCode, requesting] = useActionState<LoginStep1, FormData>(
    requestLoginCodeAction,
    { error: null, codeSent: false, needsTotp: false, maskedEmail: null }
  );
  const [step2, submitLogin, submitting] = useActionState(loginAction, { error: null });

  const atSecondStep = step1.codeSent || step1.needsTotp;

  if (!atSecondStep) {
    return (
      <form action={requestCode} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.login.email}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={creds.email}
            onChange={(e) => setCreds((c) => ({ ...c, email: e.target.value }))}
            placeholder="name@tlaqiteam.site"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.login.password}</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            defaultValue={creds.password}
            onChange={(e) => setCreds((c) => ({ ...c, password: e.target.value }))}
            placeholder="••••••••"
            className={FIELD}
          />
        </label>

        {step1.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{step1.error}</p>
        )}

        <button
          type="submit"
          disabled={requesting}
          className="mt-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: BRAND.temptress }}
        >
          {requesting ? t.login.sendingCode : t.login.continue}
        </button>

        <a
          href="/forgot-password"
          className="mt-1 text-center text-sm font-semibold text-black/45 hover:text-black/70"
        >
          {t.login.forgotLink}
        </a>
      </form>
    );
  }

  return (
    <form action={submitLogin} className="flex flex-col gap-4">
      {/* بيانات الخطوة الأولى تُمرَّر مخفيةً: الخادم يتحقّق منها مرة أخرى
          قبل قبول الرمز، فلا يكفي امتلاك الرمز وحده */}
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <input type="hidden" name="email" value={creds.email} />
      <input type="hidden" name="password" value={creds.password} />

      <div className="rounded-xl bg-[#EEF6DF]/70 px-4 py-3 text-sm leading-relaxed">
        <p className="font-semibold text-black/75">
          {step1.needsTotp ? t.login.totpTitle : t.login.codeTitle}
        </p>
        <p className="mt-1 text-xs text-black/55">
          {step1.needsTotp
            ? t.login.totpHint
            : t.login.codeHint.replace("{email}", step1.maskedEmail ?? "")}
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">
          {step1.needsTotp ? t.login.totpLabel : t.login.codeLabel}
        </span>
        <input
          name={step1.needsTotp ? "totp" : "loginCode"}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          dir="ltr"
          placeholder="000000"
          className={`${FIELD} text-center font-mono text-2xl tracking-[0.5em]`}
        />
      </label>

      {step2.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{step2.error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: BRAND.temptress }}
      >
        {submitting ? t.login.submitting : t.login.submit}
      </button>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-1 text-center text-sm font-semibold text-black/45 hover:text-black/70"
      >
        {t.login.startOver}
      </button>
    </form>
  );
}
