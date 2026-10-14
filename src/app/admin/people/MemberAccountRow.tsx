"use client";

import { useState, useTransition } from "react";
import { resetMemberCredentialsAction } from "../departments/[slug]/actions";
import { permanentlyDeleteMemberAction } from "./actions";
import { AssignDepartment } from "@/components/AssignDepartment";
import { AwardButton } from "@/components/AwardButton";
import { Card, Button } from "@/components/ui";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";

export function MemberAccountRow({
  member,
  theme,
  lapsed = false,
  canReset = true,
  canPurge = false,
  assignableDepartments,
  loginNotes,
  canAward,
}: {
  member: { id: string; fullName: string; email: string; departmentName: string };
  theme: ReturnType<typeof themeFromColor>;
  /** حساب أسقطته مهلة الـ24 ساعة — نفس الإجراء يُحييه، فيختلف النص فقط */
  lapsed?: boolean;
  /** التعيين اليدوي صار شبكة أمان للفاوندر وحده بعد إتاحة الاستعادة الذاتية */
  canReset?: boolean;
  /** المحو النهائي — للمؤسس وحده، والتصريح يُفرض في الخادم أيضاً.
   *
   *  كانت القائمة تَعرض كل عضوٍ معتمدٍ نشط بلا طريقٍ لإزالته: سجلّاتٌ
   *  أُنشئت خطأً — مكرّرةً أو بلا قسم — تبقى في «إدارة حسابات الأعضاء»
   *  تحجز بُرُدَها ولا يملك المؤسس من الواجهة ما يمحوها به. */
  canPurge?: boolean;
  /** أقسامٌ يُصنَّف فيها — تُمرَّر لغير المصنّف وحده.
   *
   *  ومن صُنِّف لا تُمرَّر له: القسم ليس وسماً يُبدَّل. والخادم يرفض على
   *  كل حال، فهذا راحةٌ للعين لا حماية. */
  assignableDepartments?: { id: string; name: string }[];
  /** مشكلاتُ دخوله — للمؤسس وحده، والخادم يحرس القراءة */
  loginNotes?: string[];
  /** يملك المُشاهد تكريمه؟ — المؤسس والتنفيذي */
  canAward?: boolean;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(member.email);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; tempPassword: string } | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeEmail, setPurgeEmail] = useState("");
  const [purgeReason, setPurgeReason] = useState("");
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgeDone, setPurgeDone] = useState<string | null>(null);

  function handleReset() {
    setError(null);
    startTransition(async () => {
      const res = await resetMemberCredentialsAction(member.id, email);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRevealed({ email: res.email!, tempPassword: res.tempPassword! });
    });
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{member.fullName}</p>
          <p className="text-xs text-black/50" dir="ltr">
            {member.email}
          </p>
          <p className="text-xs text-black/40">
            {t.misc.memberIn} — {member.departmentName}
          </p>
          {lapsed && (
            <p className="mt-1 text-xs font-semibold text-red-700">{t.candidateWindow.lapsed}</p>
          )}
          {/* مشكلةُ الدخول تُقال نصّاً: «لا يدخل» بلا سببٍ لا يُعالَج */}
          {loginNotes && loginNotes.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {loginNotes.map((n) => (
                <li key={n} className="text-xs font-semibold text-amber-800">
                  ⚠ {n}
                </li>
              ))}
            </ul>
          )}
          {/* «غير مصنّف» يُقال صريحاً: شَرطةٌ مكان القسم تُقرأ عطباً في
              العرض، وهي في الحقيقة سجلٌّ ناقصٌ يُكمَل */}
          {assignableDepartments && assignableDepartments.length > 0 && (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              {t.deptAdmin.unclassified}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canReset && (
            <Button theme={theme} variant="outline" onClick={() => setOpen((o) => !o)}>
              {lapsed ? t.candidateWindow.reissue : t.misc.loginTrouble}
            </Button>
          )}
          {canPurge && !purgeDone && (
            <button
              type="button"
              onClick={() => {
                setPurgeError(null);
                setPurgeOpen((o) => !o);
              }}
              className="inline-flex min-h-11 items-center rounded-xl bg-red-50 px-4 text-sm font-semibold text-red-800 ring-1 ring-red-300"
            >
              {t.accounts.purge}
            </button>
          )}
        </div>
      </div>

      {purgeDone && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs leading-relaxed text-green-800">
          {purgeDone}
        </p>
      )}

      {canAward && !purgeDone && (
        <div className="mt-3">
          <AwardButton
            target={{ kind: "member", id: member.id }}
            personName={member.fullName}
            theme={theme}
          />
        </div>
      )}

      {assignableDepartments && assignableDepartments.length > 0 && !purgeDone && (
        <div className="mt-3">
          <AssignDepartment
            memberId={member.id}
            departments={assignableDepartments}
            theme={theme}
          />
        </div>
      )}

      {/* المحو النهائي لسجلّ عضوية. وهو عضوٌ معتمدٌ نشط، فيحتاج إقراراً
          ثانياً صريحاً: الأصل أن تُنهى عضويته لا أن يُمحى سجلُّه —
          والاستثناء سجلٌّ أُنشئ خطأً، مكرّراً أو بلا قسم. */}
      {purgeOpen && !purgeDone && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-red-50/70 p-4 ring-1 ring-red-200">
          <p className="text-xs font-bold text-red-900">{t.accounts.purgeTitle}</p>
          <p className="text-xs leading-relaxed text-red-900/80">{t.accounts.purgeHint}</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.purgeConfirmEmail}</span>
            <input
              value={purgeEmail}
              onChange={(e) => setPurgeEmail(e.target.value)}
              dir="ltr"
              type="email"
              placeholder={member.email}
              className="min-h-11 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.accounts.purgeReason}</span>
            <textarea
              value={purgeReason}
              onChange={(e) => setPurgeReason(e.target.value)}
              rows={2}
              className="rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>
          {purgeError && <p className="text-sm font-semibold text-red-700">{purgeError}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || purgeReason.trim().length < 5 || !purgeEmail.trim()}
              onClick={() => {
                setPurgeError(null);
                startTransition(async () => {
                  const res = await permanentlyDeleteMemberAction(
                    member.id,
                    purgeEmail,
                    purgeReason,
                    true
                  );
                  if (res.error) {
                    setPurgeError(res.error);
                    return;
                  }
                  setPurgeDone(t.accounts.purgeDoneFreed);
                  setPurgeOpen(false);
                });
              }}
              className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
            >
              {pending ? t.actions.working : t.accounts.purgeConfirm}
            </button>
            <Button theme={theme} variant="ghost" onClick={() => setPurgeOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {open && !revealed && (
        <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-black/70">{t.opsExtras.emailEditable}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              type="email"
              className="min-h-11 rounded-xl border border-black/10 px-3.5 py-2.5 text-sm outline-none focus:border-black/30"
            />
          </label>
          <p className="text-xs text-black/40">
            {t.misc.resetNotice}
          </p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button theme={theme} disabled={pending} onClick={handleReset}>
              {pending
                ? t.actions.working
                : lapsed
                  ? t.candidateWindow.reissue
                  : t.actions.resetPassword}
            </Button>
            <Button theme={theme} variant="ghost" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {revealed && (
        <div className="mt-4 border-t border-black/5 pt-4">
          <CredentialsReveal
            email={revealed.email}
            tempPassword={revealed.tempPassword}
            theme={theme}
            onClose={() => {
              setRevealed(null);
              setOpen(false);
            }}
          />
        </div>
      )}
    </Card>
  );
}
