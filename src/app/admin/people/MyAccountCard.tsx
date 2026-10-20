"use client";

import { Card } from "@/components/ui";
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
}: {
  account: {
    id: string;
    fullName: string;
    email: string;
    roleLabel: string;
    /** متى وصلته بطاقتُه — جملةٌ جاهزة، و`null` لمن لم تصله. والبطاقة
     *  مرّةٌ واحدة حتى للمؤسس. */
    welcomeSentAt: string | null;
  };
  theme: ReturnType<typeof themeFromColor>;
}) {
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
      </div>

      {account.welcomeSentAt && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800">
          ✓ آخر بطاقة انضمام قُبلت عند مزوّد البريد {account.welcomeSentAt}.
        </p>
      )}

      <p className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-black/55">
        {t.accounts.myAccountHint}
      </p>

    </Card>
  );
}
