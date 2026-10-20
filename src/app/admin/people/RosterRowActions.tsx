"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionsMenu, type MenuItem } from "@/components/ActionsMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { sendWelcomeToMemberAction } from "../actions";
import { sendWelcomeToUserAction } from "./actions";

/** إجراءاتُ صفٍّ في السجلّ: «عرض الملف» ظاهراً، والباقي في «⋯».
 *
 *  إعادةُ بطاقة الانضمام تمرّ بنافذة تأكيد ثم بالإجراء القائم نفسه
 *  (`sendWelcomeToMember` / `sendWelcomeToUser`) — وهو من يقرّر من يملكها
 *  ومتى تُرفض، ويُقال سببُ الرفض كما جاء. وإجراءاتُ الحساب الكاملة (كلمة
 *  المرور، التنحية، الحذف) في ملف الشخص — لا تُكرَّر هنا. */
export function RosterRowActions({
  kind,
  id,
  name,
  profileHref,
  canResendWelcome,
}: {
  kind: "user" | "member";
  id: string;
  name: string;
  profileHref: string;
  canResendWelcome: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const items: MenuItem[] = [
    { kind: "link", label: "عرض الملف", href: profileHref },
    ...(canResendWelcome
      ? ([{ kind: "action", label: "إعادة إرسال بطاقة الانضمام", onSelect: () => setConfirm(true) }] as MenuItem[])
      : []),
    { kind: "separator" },
    { kind: "link", label: "إدارة الحساب…", href: `${profileHref}#manage` },
  ];

  function resend() {
    setError(null);
    start(async () => {
      const res = kind === "member" ? await sendWelcomeToMemberAction(id) : await sendWelcomeToUserAction(id);
      if (res.error) return setError(res.error);
      setConfirm(false);
      setNote(`قُبلت عند مزوّد البريد${res.to ? ` — ${res.to}` : ""}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {note && <span role="status" className="text-xs font-bold text-green-800">{note}</span>}
      <Link href={profileHref} className="wizard-btn-2 !min-h-9 !px-3 !text-xs">
        عرض الملف
      </Link>
      <ActionsMenu label={`إجراءات ${name}`} items={items} />
      <ConfirmDialog
        open={confirm}
        title="إعادة إرسال بطاقة الانضمام"
        body={`تُرسَل بطاقة الانضمام إلى ${name} الآن. وتُسجَّل في سجل الرسائل بنتيجتها.`}
        confirmLabel="إرسال"
        tone="brand"
        pending={pending}
        error={error}
        onConfirm={resend}
        onCancel={() => {
          setConfirm(false);
          setError(null);
        }}
      />
    </div>
  );
}
