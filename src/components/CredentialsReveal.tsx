"use client";

import { useState } from "react";
import type { themeFromColor } from "@/lib/brand";

/** يعرض كلمة المرور المؤقتة لمرة واحدة فور إنشائها، مع زر نسخ — نسخة احتياطية
 *  للبريد الإلكتروني حتى يقدر من أنشأ الحساب يرسلها يدوياً (واتساب، شخصياً...).
 *  بعد إغلاق هذه البطاقة لا تظهر كلمة المرور لأحد مرة أخرى. */
export function CredentialsReveal({
  email,
  tempPassword,
  theme,
  onClose,
}: {
  email: string;
  tempPassword: string;
  theme: ReturnType<typeof themeFromColor>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`البريد: ${email}\nكلمة المرور المؤقتة: ${tempPassword}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // تجاهل بصمت — بعض المتصفحات تمنع الوصول للحافظة خارج سياق آمن
    }
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: theme.surface, borderColor: theme.accentDark + "55" }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-bold" style={{ color: theme.accentDark }}>
          تم إنشاء بيانات الدخول — انسخها الآن وأرسلها يدوياً إن احتجت
        </p>
        <button type="button" onClick={onClose} className="text-xs text-black/40 hover:text-black/60">
          إغلاق ✕
        </button>
      </div>
      <p className="text-xs text-black/50">هذه آخر مرة تظهر فيها كلمة المرور هذه — لن تُحفظ ولن تُعرض بعد الإغلاق.</p>
      <div className="mt-3 flex flex-col gap-1 rounded-lg bg-white px-3 py-2 text-sm" dir="ltr">
        <span>{email}</span>
        <span className="font-mono font-bold tracking-wide">{tempPassword}</span>
      </div>
      <button
        type="button"
        onClick={copy}
        className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold"
        style={{ background: theme.accentDark, color: "#FDFBF6" }}
      >
        {copied ? "تم النسخ ✓" : "نسخ البريد وكلمة المرور"}
      </button>
    </div>
  );
}
