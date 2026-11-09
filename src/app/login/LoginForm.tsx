"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { loginAction, requestLoginCodeAction, resendLoginCodeAction, type LoginStep1 } from "./actions";
import { useTranslations } from "@/i18n/LocaleProvider";
import { NavGlyph } from "@/components/icons";

const FIELD =
  "min-h-11 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none transition-shadow placeholder:text-black/35 focus:border-[var(--brand-temptress)] focus:ring-2 focus:ring-[var(--brand-temptress)]/15";

/** الدخول على خطوتين: كلمة المرور أولاً، ثم رمز يصل إلى البريد.
 *
 *  الخطوتان في مكوّن واحد لا صفحتين: الانتقال لصفحة أخرى يعني حمل كلمة
 *  المرور في الرابط أو في الجلسة قبل اكتمال الدخول، وكلاهما أسوأ من
 *  إبقائها في الذاكرة لحظات. */
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations();
  const [creds, setCreds] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);

  const [step1, requestCode, requesting] = useActionState<LoginStep1, FormData>(
    requestLoginCodeAction,
    { error: null, codeSent: false, needsTotp: false, maskedEmail: null }
  );
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
            placeholder="name@example.com"
            dir="ltr"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-black/70">{t.login.password}</span>
          {/* الغلافُ باتجاه الحقل نفسه (ltr): هامشُ الحقل والزرُّ على الجهة ذاتها */}
          <span className="relative" dir="ltr">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              defaultValue={creds.password}
              onChange={(e) => setCreds((c) => ({ ...c, password: e.target.value }))}
              placeholder="••••••••"
              dir="ltr"
              className={`${FIELD} w-full pe-12`}
            />
            {/* إظهارُ ما كُتب: أخطاءُ كلمة المرور على الجوال أكثرُ أسباب تعثّر الدخول */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t.login.hidePassword : t.login.showPassword}
              aria-pressed={showPassword}
              title={showPassword ? t.login.hidePassword : t.login.showPassword}
              className="absolute inset-y-0 end-0 inline-flex w-12 items-center justify-center text-lg text-black/45 hover:text-black/75"
            >
              <NavGlyph name={showPassword ? "eyeOff" : "eye"} />
            </button>
          </span>
        </label>

        {step1.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{step1.error}</p>
        )}

        <button
          type="submit"
          disabled={requesting}
          className="btn-brand mt-2 rounded-xl px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
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

  return <CodeStep step1={step1} creds={creds} callbackUrl={callbackUrl} />;
}

/** «م:ث» — لعدّادَي الصلاحية والإعادة */
function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** الخطوة الثانية: رمز البريد (أو تطبيق المصادقة)، ومعه **إعادة إرسال رمز التحقق**.
 *
 *  الزرّ ظاهرٌ دائماً ومعطّلٌ بعدّادٍ حتى تنقضي مهلة الإعادة؛ والخادمُ يفرض المهلة
 *  والسقف ثانيةً ويتحقّق من كلمة المرور، فلا يكفي تعطيلُ الزرّ ولا إظهارُه. */
function CodeStep({
  step1,
  creds,
  callbackUrl,
}: {
  step1: LoginStep1;
  creds: { email: string; password: string };
  callbackUrl: string;
}) {
  const t = useTranslations();
  const [step2, submitLogin, submitting] = useActionState(loginAction, { error: null });
  // من يملك تطبيق المصادقة يختار طريقه؛ الافتراض رمز البريد لأنه وصل للتوّ
  const [useTotp, setUseTotp] = useState(false);
  const [timers, setTimers] = useState({
    expiresAt: step1.codeExpiresAt ?? null,
    resendAt: step1.resendAt ?? null,
    masked: step1.maskedEmail ?? "",
  });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [resending, startResend] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const waitMs = timers.resendAt ? timers.resendAt - now : 0;
  const expired = timers.expiresAt !== null && timers.expiresAt <= now;
  const canResend = waitMs <= 0 && !resending;

  function resend() {
    setNotice(null);
    startResend(async () => {
      const res = await resendLoginCodeAction({ email: creds.email, password: creds.password });
      if (res.ok) {
        setTimers({ expiresAt: res.codeExpiresAt, resendAt: res.resendAt, masked: res.maskedEmail });
        setNotice({ ok: true, text: t.login.resendSent.replace("{email}", res.maskedEmail).replace("{0}", res.maskedEmail) });
      } else {
        if (res.retryAt) setTimers((x) => ({ ...x, resendAt: res.retryAt! }));
        setNotice({ ok: false, text: res.error });
      }
    });
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
          {useTotp ? t.login.totpTitle : t.login.codeTitle}
        </p>
        <p className="mt-1 text-xs text-black/55">
          {useTotp
            ? t.login.totpHint
            : t.login.codeHint.replace("{email}", timers.masked)}
        </p>
      </div>

      {/* الطريقان معاً لمن يملكهما: ضياع الجهاز لا يحبسه، وتأخّر البريد
          لا يوقفه */}
      {step1.needsTotp && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/[0.04] p-1">
          <button
            type="button"
            onClick={() => setUseTotp(false)}
            className={`min-h-10 rounded-lg text-xs font-semibold transition-colors ${
              !useTotp ? "bg-white shadow-sm" : "text-black/50"
            }`}
          >
            {t.login.methodEmail}
          </button>
          <button
            type="button"
            onClick={() => setUseTotp(true)}
            className={`min-h-10 rounded-lg text-xs font-semibold transition-colors ${
              useTotp ? "bg-white shadow-sm" : "text-black/50"
            }`}
          >
            {t.login.methodApp}
          </button>
        </div>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">
          {useTotp ? t.login.totpLabel : t.login.codeLabel}
        </span>
        <input
          key={useTotp ? "totp" : "loginCode"}
          name={useTotp ? "totp" : "loginCode"}
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

      {!useTotp && (
        <div className="flex flex-col gap-2 rounded-xl border border-black/10 px-3.5 py-3 text-sm">
          {timers.expiresAt !== null && (
            <p className={`text-xs font-semibold ${expired ? "text-red-700" : "text-black/55"}`}>
              {expired ? t.login.codeExpired : t.login.codeExpiresIn.replace("{0}", clock(timers.expiresAt - now))}
            </p>
          )}
          <button
            type="button"
            onClick={resend}
            disabled={!canResend}
            aria-describedby="resend-policy"
            className="wizard-btn-2 min-h-11 w-full justify-center disabled:opacity-50 sm:w-auto"
          >
            {resending
              ? t.login.resending
              : waitMs > 0
                ? `${t.login.resendCode} (${clock(waitMs)})`
                : t.login.resendCode}
          </button>
          {waitMs > 0 && !resending && (
            <p className="text-xs text-black/50">{t.login.resendIn.replace("{0}", clock(waitMs))}</p>
          )}
          <p id="resend-policy" className="text-xs leading-relaxed text-black/45">
            {t.login.resendPolicy}
          </p>
          <p role="status" aria-live="polite" className="empty:hidden">
            {notice && (
              <span
                className={`block rounded-lg px-3 py-2 text-sm ${notice.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
              >
                {notice.text}
              </span>
            )}
          </p>
        </div>
      )}

      {/* الاختيار في الخطوة الثانية لا الأولى: هنا يكتمل الدخول فعلاً،
          ووضعه في الأولى يجعله يُنسى بين الخطوتين */}
      <label className="flex items-start gap-2.5 rounded-xl bg-black/[0.03] px-3.5 py-3 text-sm">
        <input type="checkbox" name="remember" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium text-black/75">{t.login.rememberLabel}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-black/45">
            {t.login.rememberHint}
          </span>
        </span>
      </label>

      {step2.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{step2.error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-brand mt-2 rounded-xl px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
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
