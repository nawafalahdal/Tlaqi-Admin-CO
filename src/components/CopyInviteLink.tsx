"use client";

import { useState } from "react";
import { useTranslations } from "@/i18n/LocaleProvider";

/** زر نسخ رابط دعوة قائمة — يسمح باسترجاع الرابط في أي وقت بعد إصداره، لا مرة
 *  واحدة فقط لحظة الإنشاء. ضروري لأن البريد قد لا يصل، فيبقى الرابط الطريقة
 *  الوحيدة ليبدأ المدعو اختباره. */
export function CopyInviteLink({ inviteUrl }: { inviteUrl: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // المتصفح منع الحافظة — نعرض الرابط نصاً ليُنسخ يدوياً
      setShown(true);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-semibold text-black/70 hover:bg-black/5"
        >
          {copied ? t.actions.copied : t.actions.copyLink}
        </button>
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-black/40 hover:text-black/70"
        >
          {shown ? t.actions.hide : t.actions.show}
        </button>
      </div>
      {shown && (
        <code className="block max-w-[260px] break-all rounded-md bg-black/5 px-2 py-1 text-[10px]" dir="ltr">
          {inviteUrl}
        </code>
      )}
    </div>
  );
}
