"use client";

import { useState } from "react";
import type { themeFromColor } from "@/lib/brand";

/** يعرض رابط الدعوة فور إصدارها، مع زر نسخ — نسخة احتياطية يدوية حتى لو
 *  البريد الإلكتروني غير مُفعَّل على الخادم أو لم يصل. بدون هذا الرابط لا
 *  يقدر المدعو يبدأ الاختبار أصلاً، فما توجد بيانات دخول ليُعتمد. */
export function InviteLinkReveal({
  inviteUrl,
  theme,
  onClose,
}: {
  inviteUrl: string;
  theme: ReturnType<typeof themeFromColor>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
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
          تم إصدار الدعوة — انسخ الرابط وأرسله للمدعو يدوياً
        </p>
        <button type="button" onClick={onClose} className="text-xs text-black/40 hover:text-black/60">
          إغلاق ✕
        </button>
      </div>
      <p className="text-xs text-black/50">
        إذا لم يصل البريد الإلكتروني، هذا الرابط هو الطريقة الوحيدة ليبدأ المدعو اختباره.
      </p>
      <div className="mt-3 break-all rounded-lg bg-white px-3 py-2 text-xs" dir="ltr">
        {inviteUrl}
      </div>
      <button
        type="button"
        onClick={copy}
        className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold"
        style={{ background: theme.accentDark, color: "#FDFBF6" }}
      >
        {copied ? "تم النسخ ✓" : "نسخ رابط الدعوة"}
      </button>
    </div>
  );
}
