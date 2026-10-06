"use client";

import { useState } from "react";
import { ApprovalRow } from "./ApprovalRow";
import { Card } from "@/components/ui";
import { useTranslations } from "@/i18n/LocaleProvider";

type Member = {
  id: string;
  fullName: string;
  email: string;
  testScore: number | null;
  departmentName: string;
  departmentColor: string;
};

/** يلف قائمة طلبات الاعتماد في مكوّن عميل دائم — لأن الموافقة على طلب تُسقطه
 *  فوراً من قائمة الخادم بعد إعادة التحقق، فأي حالة محلية داخل صف الطلب نفسه
 *  تُفقد لحظة اختفائه. هذا المكوّن الأب يبقى مثبّتاً دائماً فيحمل رسالة
 *  التأكيد بمعزل عن اختفاء الصف.
 *
 *  هذا الثبات ينهار إن قرر المكوّن الأب (الصفحة) عدم تركيب <ApprovalQueue>
 *  أصلاً عندما تصبح القائمة فارغة (نمط: `list.length === 0 ? <Empty/> :
 *  <ApprovalQueue/>`) — فالحالة تُدمَّر مع المكوّن كاملاً قبل أن يراها
 *  المستخدم. لذلك تُعرَّف حالة "لا يوجد" هنا داخلياً، ويجب أن يُركَّب هذا
 *  المكوّن دائماً من الصفحة الأم بصرف النظر عن طول members. */
export function ApprovalQueue({
  members,
  emptyMessage,
}: {
  members: Member[];
  emptyMessage: string;
  /** يبقى مقبولاً للتوافق مع لوحات الأقسام وإن لم يعد يُستخدم بعد نقل بطاقة
   *  بيانات الدخول من لحظة الاعتماد إلى لحظة إنشاء الحساب */
  themeColorHex?: string;
}) {
  const [approved, setApproved] = useState<string | null>(null);
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-3">
      {approved && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800">
            {t.admin.approvedNotice.replace("{name}", approved)}
          </p>
          <button
            type="button"
            onClick={() => setApproved(null)}
            className="min-h-11 text-sm font-semibold text-green-800/70"
          >
            {t.common.close}
          </button>
        </Card>
      )}
      {members.length === 0 && !approved && (
        <Card className="p-8 text-center text-sm text-black/40">{emptyMessage}</Card>
      )}
      {members.map((m) => (
        <ApprovalRow key={m.id} member={m} onApproved={setApproved} />
      ))}
    </div>
  );
}
