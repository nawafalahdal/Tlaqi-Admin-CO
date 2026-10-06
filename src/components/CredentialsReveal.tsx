"use client";

import { useState } from "react";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

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
  const t = useTranslations();

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${email}\n${tempPassword}`);
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
          {t.admin.credentialsCreated}
        </p>
        <button type="button" onClick={onClose} className="text-xs text-black/40 hover:text-black/60">
          {t.common.close}
        </button>
      </div>
      <p className="text-xs text-black/50">{t.admin.credentialsOnce}</p>
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
        {copied ? t.admin.copied : t.admin.copy}
      </button>
    </div>
  );
}
