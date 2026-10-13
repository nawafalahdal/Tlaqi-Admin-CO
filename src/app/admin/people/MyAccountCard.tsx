"use client";

import { useState, useTransition } from "react";
import { sendWelcomeToUserAction } from "./actions";
import { Card, Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

/** حساب المؤسس نفسه — يُعرض ولا يُحذف، وله زرُّ بطاقته.
 *
 *  حسابه كان خارج القائمة كلّها: قائمة الحسابات تستثني `super_admin`
 *  حتى لا يُعرَض لنفسه إجراءُ تنحيةٍ أو حذف. فكان لا يجد طريقاً إلى
 *  بطاقته — لا ليراها كما يراها أعضاؤه ولا ليتحقّق من شكلها قبل أن
 *  تُرسَل. فصار له بطاقةٌ هنا: تُخبره أن حسابه محميٌّ، وتُرسل بطاقته.
 *
 *  والحماية ليست في هذا الملف: `permanentlyDeleteAccount` و
 *  `removeLeadershipUser` يرفضان حسابَ المؤسس في الخادم. وهذا النصّ
 *  يُخبر بالقاعدة، لا يُنشئها. */
export function MyAccountCard({
  account,
  theme,
}: {
  account: {
    id: string;
    fullName: string;
    email: string;
    roleLabel: string;
    /** تاريخ وصول بطاقته — البطاقة مرّةٌ واحدة حتى للمؤسس */
    welcomeSentAt: string | null;
  };
  theme: ReturnType<typeof themeFromColor>;
}) {
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations();

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{account.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {account.email}
          </p>
          <p className="text-xs text-black/40">{account.roleLabel}</p>
        </div>
        {account.welcomeSentAt ? null : (
        <Button
          theme={theme}
          variant="outline"
          disabled={pending}
          onClick={() => {
            setMsg(null);
            startTransition(async () => {
              const res = await sendWelcomeToUserAction(account.id);
              setMsg(
                res.error
                  ? { kind: "err", text: res.error }
                  : { kind: "ok", text: `وصلت البطاقة إلى ${res.to}` }
              );
            });
          }}
        >
          {pending ? t.actions.working : t.accounts.sendWelcome}
        </Button>
        )}
      </div>

      {account.welcomeSentAt && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">
          ✓ وصلتك بطاقة الانضمام في {account.welcomeSentAt} — وتُرسل مرّةً واحدة، فانتهت صلاحية
          الإرسال.
        </p>
      )}

      <p className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/55">
        {t.accounts.myAccountHint}
      </p>

      {msg && (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {msg.text}
        </p>
      )}
    </Card>
  );
}
