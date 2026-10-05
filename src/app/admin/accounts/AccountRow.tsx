"use client";

import { useState, useTransition } from "react";
import { resetUserCredentialsAction } from "./actions";
import { Card, Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";

const ROLE_LABELS: Record<string, string> = {
  executive: "الإدارة التنفيذية (CEO)",
  operations_officer: "مسؤول التشغيل",
  department_admin: "قائد قسم",
};

export function AccountRow({
  account,
  theme,
}: {
  account: { id: string; fullName: string; email: string; role: string; departmentName: string | null };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(account.email);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const res = await resetUserCredentialsAction(account.id, email);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRevealed({ email: res.email!, tempPassword: res.tempPassword! });
    });
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{account.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {account.email}
          </p>
          <p className="text-xs text-black/40">
            {ROLE_LABELS[account.role] ?? account.role}
            {account.departmentName ? ` — ${account.departmentName}` : ""}
          </p>
        </div>
        <Button theme={theme} variant="outline" onClick={() => setOpen((o) => !o)}>
          مشكلة دخول؟
        </Button>
      </div>

      {open && !revealed && (
        <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
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
            سيولَّد رمز مرور مؤقت جديد ويُرسل للبريد أعلاه، ويُطلب تغييره فور الدخول التالي.
          </p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button theme={theme} disabled={pending} onClick={handleReset}>
              {pending ? "جارِ التنفيذ..." : "إعادة تعيين كلمة المرور"}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {revealed && (
        <div className="mt-4 border-t border-black/5 pt-4">
          <CredentialsReveal
            email={revealed.email}
            tempPassword={revealed.tempPassword}
            theme={theme}
            onClose={() => {
              setRevealed(null);
              setOpen(false);
            }}
          />
        </div>
      )}
    </Card>
  );
}
