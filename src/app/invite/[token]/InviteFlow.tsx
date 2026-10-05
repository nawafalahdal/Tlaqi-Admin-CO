"use client";

import { useState } from "react";
import { confirmInviteEmailAction, submitInviteTestAction } from "./actions";
import { TEST_QUESTIONS } from "@/lib/testQuestions";
import type { themeFromColor } from "@/lib/brand";
import { readableTextOn } from "@/lib/colors";

type Theme = ReturnType<typeof themeFromColor>;
type Step = "confirm" | "test" | "result" | "already-used" | "expired";

export function InviteFlow({
  token,
  fullName,
  email,
  departmentName,
  theme,
  initialStatus,
}: {
  token: string;
  fullName: string;
  email: string;
  departmentName: string;
  theme: Theme;
  initialStatus: "open" | "used" | "expired";
}) {
  // يُحسب مرة واحدة فقط عند أول تحميل — لا يتأثر بإعادة تصيير الخادم بعد أي Server Action
  // (Next.js يُحدّث بيانات الصفحة تلقائياً بعد كل Server Action، وبما أن حالة الدعوة
  // تتحول إلى "used" فور إرسال الاختبار، فإن الاعتماد على initialStatus مباشرة كان
  // سيُسقط شاشة النتيجة بعد ظهورها بلحظات).
  const [step, setStep] = useState<Step>(() =>
    initialStatus === "used" ? "already-used" : initialStatus === "expired" ? "expired" : "confirm"
  );
  const [emailInput, setEmailInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await confirmInviteEmailAction(token, emailInput);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "حدث خطأ");
      return;
    }
    setStep("test");
  }

  const question = TEST_QUESTIONS[qIndex];
  const isLast = qIndex === TEST_QUESTIONS.length - 1;
  const canNext = answers[question.id] !== undefined;

  async function handleSubmitTest() {
    setPending(true);
    const res = await submitInviteTestAction(token, answers);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "حدث خطأ أثناء إرسال الإجابات");
      return;
    }
    setResult({ score: res.score, passed: res.passed });
    setStep("result");
  }

  const buttonTextColor = readableTextOn(theme.accentDark);

  if (step === "already-used") {
    return (
      <StateCard
        theme={theme}
        title="تم استخدام هذه الدعوة من قبل"
        body="سبق أن أكملت الاختبار عبر هذا الرابط. سيتواصل معك القسم المعني بخصوص نتيجتك."
      />
    );
  }

  if (step === "expired") {
    return (
      <StateCard
        theme={theme}
        title="انتهت صلاحية الدعوة"
        body="يرجى التواصل مع من دعاك لإصدار رابط جديد."
      />
    );
  }

  if (step === "confirm") {
    return (
      <div className="rounded-3xl bg-white p-8 shadow-xl">
        <p className="mb-1 text-xs font-semibold" style={{ color: theme.accentDark }}>
          دعوة انضمام — قسم {departmentName}
        </p>
        <h1 className="mb-6 text-xl font-bold">مرحباً {fullName}</h1>

        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">
              للتأكد أن هذا الرابط لك، أدخل بريدك الإلكتروني
            </span>
            <input
              type="email"
              required
              dir="ltr"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={email.replace(/(.{2}).+(@.+)/, "$1***$2")}
              className="rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-black/30"
            />
          </label>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-xl px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: theme.accentDark, color: buttonTextColor }}
          >
            {pending ? "جارِ التحقق..." : "متابعة لبدء الاختبار"}
          </button>
        </form>
      </div>
    );
  }

  if (step === "test") {
    return (
      <div className="rounded-3xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center justify-between text-xs text-black/40">
          <span>
            السؤال {qIndex + 1} من {TEST_QUESTIONS.length}
          </span>
          <span>اختبار قبول قسم {departmentName}</span>
        </div>

        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-black/5">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${((qIndex + 1) / TEST_QUESTIONS.length) * 100}%`,
              background: theme.accentDark,
            }}
          />
        </div>

        <h2 className="mb-5 text-lg font-bold leading-relaxed">{question.prompt}</h2>

        <div className="flex flex-col gap-2.5">
          {question.options.map((opt, i) => {
            const selected = answers[question.id] === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setAnswers((a) => ({ ...a, [question.id]: i }))}
                className="rounded-xl border px-4 py-3 text-start text-sm font-medium transition-colors"
                style={
                  selected
                    ? { background: theme.surface, borderColor: theme.accentDark, color: theme.accentDark }
                    : { borderColor: "#00000014", color: "#1A1023" }
                }
              >
                {opt}
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-7 flex items-center justify-between">
          <button
            type="button"
            disabled={qIndex === 0}
            onClick={() => setQIndex((i) => Math.max(0, i - 1))}
            className="text-sm font-semibold text-black/40 disabled:opacity-0"
          >
            السابق
          </button>

          {isLast ? (
            <button
              type="button"
              disabled={!canNext || pending}
              onClick={handleSubmitTest}
              className="rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: theme.accentDark, color: buttonTextColor }}
            >
              {pending ? "جارِ الإرسال..." : "إرسال الإجابات"}
            </button>
          ) : (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setQIndex((i) => Math.min(TEST_QUESTIONS.length - 1, i + 1))}
              className="rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: theme.accentDark, color: buttonTextColor }}
            >
              التالي
            </button>
          )}
        </div>
      </div>
    );
  }

  // step === "result"
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-xl">
      <div
        className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
        style={{
          background: result?.passed ? "#E3F3E8" : theme.surface,
          color: result?.passed ? "#1F6B3A" : theme.accentDark,
        }}
      >
        {result?.passed ? "✓" : "!"}
      </div>
      <h1 className="mb-2 text-xl font-bold">
        {result?.passed ? "تهانينا، اجتزت الاختبار" : "لم تحقق النسبة المطلوبة هذه المرة"}
      </h1>
      <p className="mb-1 text-sm text-black/60">نتيجتك: {result?.score}%</p>
      <p className="mx-auto max-w-sm text-sm text-black/60">
        {result?.passed
          ? `طلبك الآن بانتظار الاعتماد النهائي من قسم ${departmentName}. سيتم التواصل معك قريباً.`
          : `سيتواصل معك فريق ${departmentName} لجدولة اجتماع شرح قصير.`}
      </p>
    </div>
  );
}

function StateCard({ theme, title, body }: { theme: Theme; title: string; body: string }) {
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-xl">
      <h1 className="mb-2 text-lg font-bold" style={{ color: theme.accentDark }}>
        {title}
      </h1>
      <p className="text-sm text-black/60">{body}</p>
    </div>
  );
}
