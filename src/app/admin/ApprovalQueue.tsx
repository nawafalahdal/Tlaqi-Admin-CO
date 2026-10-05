"use client";

import { useState } from "react";
import { ApprovalRow } from "./ApprovalRow";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import { themeFromColor, SUPER_ADMIN_THEME } from "@/lib/brand";

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
 *  (مثل بطاقة كلمة المرور المؤقتة) تُفقد لحظة اختفائه. هذا المكوّن الأب يبقى
 *  مثبّتاً دائماً فيحمل حالة الكشف عن بيانات الدخول بمعزل عن اختفاء الصف. */
export function ApprovalQueue({
  members,
  themeColorHex = SUPER_ADMIN_THEME.colorHex,
}: {
  members: Member[];
  themeColorHex?: string;
}) {
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);
  const theme = themeFromColor(themeColorHex);

  return (
    <div className="flex flex-col gap-3">
      {revealed && (
        <CredentialsReveal
          email={revealed.email}
          tempPassword={revealed.tempPassword}
          theme={theme}
          onClose={() => setRevealed(null)}
        />
      )}
      {members.map((m) => (
        <ApprovalRow key={m.id} member={m} onApproved={setRevealed} />
      ))}
    </div>
  );
}
