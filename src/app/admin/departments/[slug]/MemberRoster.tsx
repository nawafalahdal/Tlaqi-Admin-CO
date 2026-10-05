"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { issueWarningAction, resetMemberCredentialsAction } from "./actions";
import { Card, Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";

type RosterMember = {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  warningsCount: number;
};

export function MemberRoster({
  members,
  theme,
}: {
  members: RosterMember[];
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);

  if (members.length === 0) {
    return <Card className="p-8 text-center text-sm text-black/40">لا يوجد أعضاء نشطون في القسم بعد</Card>;
  }

  return (
    <div className="flex flex-col gap-3">
      {members.map((m) => (
        <Card key={m.id} className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {m.fullName} {m.jobTitle && <span className="text-black/40">— {m.jobTitle}</span>}
              </p>
              <p className="text-xs text-black/50" dir="ltr">
                {m.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <WarningBadge count={m.warningsCount} />
              <Button
                theme={theme}
                variant="ghost"
                onClick={() => setOpenFor(openFor === `reset-${m.id}` ? null : `reset-${m.id}`)}
              >
                مشكلة دخول؟
              </Button>
              <Button
                theme={theme}
                variant="outline"
                onClick={() => setOpenFor(openFor === `warn-${m.id}` ? null : `warn-${m.id}`)}
              >
                إصدار تنبيه
              </Button>
            </div>
          </div>
          {openFor === `warn-${m.id}` && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <WarningForm memberId={m.id} theme={theme} onDone={() => setOpenFor(null)} />
            </div>
          )}
          {openFor === `reset-${m.id}` && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <ResetCredentialsForm
                memberId={m.id}
                currentEmail={m.email}
                theme={theme}
                onDone={() => setOpenFor(null)}
              />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function WarningBadge({ count }: { count: number }) {
  if (count === 0) return null;
  const color = count >= 3 ? "#9A2E1C" : count === 2 ? "#8A5A00" : "#30406B";
  const bg = count >= 3 ? "#FBE5E1" : count === 2 ? "#FFF1DE" : "#E8ECF7";
  return (
    <span
      className="rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: bg, color }}
    >
      تنبيهات: {count}/3
    </span>
  );
}

function WarningForm({
  memberId,
  theme,
  onDone,
}: {
  memberId: string;
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(issueWarningAction, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement>(null);

  if (state.success) {
    return <p className="text-sm text-green-700">تم إرسال التنبيه للعضو بنجاح.</p>;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="memberId" value={memberId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">سبب التنبيه</span>
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="وضّح السبب بدقة — سيصل هذا النص للعضو"
          className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <Button theme={theme} type="submit" disabled={pending}>
          {pending ? "جارِ الإرسال..." : "إرسال التنبيه"}
        </Button>
        <Button theme={theme} variant="ghost" onClick={onDone}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}

function ResetCredentialsForm({
  memberId,
  currentEmail,
  theme,
  onDone,
}: {
  memberId: string;
  currentEmail: string;
  theme: ReturnType<typeof themeFromColor>;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(currentEmail);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);

  if (revealed) {
    return (
      <div className="flex flex-col gap-3">
        <CredentialsReveal
          email={revealed.email}
          tempPassword={revealed.tempPassword}
          theme={theme}
          onClose={onDone}
        />
      </div>
    );
  }

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const res = await resetMemberCredentialsAction(memberId, email);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRevealed({ email: res.email!, tempPassword: res.tempPassword! });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-black/70">البريد الإلكتروني (عدّله إذا لزم)</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
          type="email"
          className="rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
        />
      </label>
      <p className="text-xs text-black/40">
        سيولَّد رمز مرور مؤقت جديد ويُرسل للبريد أعلاه، ويُطلب من العضو تغييره فور الدخول.
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button theme={theme} disabled={pending} onClick={handleReset}>
          {pending ? "جارِ التنفيذ..." : "إعادة تعيين كلمة المرور"}
        </Button>
        <Button theme={theme} variant="ghost" onClick={onDone}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
