"use client";

import Link from "next/link";
import { ActionsMenu, type MenuItem } from "@/components/ActionsMenu";

/** إجراءاتُ صفٍّ في السجلّ: «عرض الملف» ظاهراً، والباقي في «⋯».
 *
 *  وإجراءاتُ الحساب الكاملة (كلمة المرور، التنحية، الحذف) في ملف الشخص —
 *  لا تُكرَّر هنا. وإعادةُ بطاقة الانضمام ليست هنا: هي بيد مسؤول المتابعة
 *  والتشغيل وحده، من صفحة «بطاقات الانضمام». */
export function RosterRowActions({
  name,
  profileHref,
}: {
  kind: "user" | "member";
  id: string;
  name: string;
  profileHref: string;
}) {
  const manageHref = `${profileHref.split("?")[0]}#manage`;
  const items: MenuItem[] = [
    { kind: "link", label: "عرض الملف", href: profileHref },
    { kind: "separator" },
    { kind: "link", label: "إدارة الحساب…", href: manageHref },
  ];

  return (
    <div className="flex items-center justify-end gap-2">
      <Link href={profileHref} className="wizard-btn-2 !min-h-9 !px-3 !text-xs">
        عرض الملف
      </Link>
      <ActionsMenu label={`إجراءات ${name}`} items={items} />
    </div>
  );
}
