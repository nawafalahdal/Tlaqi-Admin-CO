"use client";

import { useState, useTransition } from "react";
import { approveMemberAction as approveMemberAction__server } from "@/app/admin/actions";
import { rejectCandidateAction as rejectCandidateAction__server } from "../../actions";
import { WarningForm } from "@/app/admin/departments/[slug]/MemberRoster";
import { NeedsMeetingRow } from "@/app/admin/departments/[slug]/NeedsMeetingRow";
import { CertificateAction } from "@/app/admin/welcome-cards/CertificateAction";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CredentialsReveal } from "@/components/CredentialsReveal";
import { Card } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
import { guardAction } from "@/lib/actionGuard";

const approveMemberAction = guardAction(approveMemberAction__server);
const rejectCandidateAction = guardAction(rejectCandidateAction__server);

/** **إجراءاتُ العضو في مكانٍ واحد** (قرار المؤسس، 24 نوفمبر 2026 — «إدارةُ العضو من صفحته، لا من أماكن كثيرة»).
 *
 *  يُعرض لكلٍّ ما تسمح به صلاحيتُه وحده، والخادمُ يحسبها (`decide`، `canWarn`، `canCertify`) ويفرضها ثانيةً عند كل إجراء:
 *  - **مرشّحٌ ينتظر الحسم:** اعتمادٌ أو رفض (اجتاز)، أو إعادةُ اختبارٍ أو رفض (لم يجتز) — لجهة حسمه وحدها؛ وغيرُها يرى من يحسمه.
 *  - **عضوٌ معتمد:** تنبيهٌ رسمي، وشهادةُ تقدير.
 *  وما بقي من إدارة الحساب (التكريم، وبطاقة الترحيب، وبيانات الدخول، والحذف) في «إدارة الحساب» أسفل الصفحة نفسِها. */
export function MemberActionCenter({
  member,
  theme,
  decide,
  decidedBy,
  canWarn,
  canCertify,
}: {
  member: { id: string; fullName: string; email: string; testScore: number | null };
  theme: ReturnType<typeof themeFromColor>;
  /** «approve» اجتاز وينتظر الاعتماد، «failed» لم يجتز — لجهة حسمه وحدها */
  decide: "approve" | "failed" | null;
  /** لمن لا يحسم: من يحسم أمره (يُعرض ولا يُتّخذ) */
  decidedBy: string | null;
  canWarn: boolean;
  canCertify: boolean;
}) {
  const t = useTranslations();
  const A = t.memberActions;
  const [panel, setPanel] = useState<"none" | "warn" | "certificate">("none");
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!decide && !decidedBy && !canWarn && !canCertify) return null;

  const run = (kind: "approve" | "reject") =>
    startTransition(async () => {
      setError(null);
      try {
        if (kind === "approve") {
          const res = (await approveMemberAction(member.id)) as { email?: string; tempPassword?: string; error?: string };
          if (res?.error) return setError(res.error);
          if (res?.tempPassword && res.email) setCredentials({ email: res.email, tempPassword: res.tempPassword });
          setDone(A.approved);
        } else {
          const res = await rejectCandidateAction(member.id);
          if (res.error) return setError(res.error);
          setDone(A.rejected);
        }
        setAsking(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : A.failed);
      }
    });

  const btn = "inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ring-1 transition";
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-base font-bold">{A.title}</h2>
      {done && <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">{done}</p>}
      {credentials && <CredentialsReveal email={credentials.email} tempPassword={credentials.tempPassword} theme={theme} onClose={() => setCredentials(null)} />}

      {!done && decide === "failed" && (
        <div className="mt-3">
          <NeedsMeetingRow theme={theme} member={member} />
        </div>
      )}
      {!done && decidedBy && <p className="mt-2 text-sm text-black/60">{fmt(A.decidedBy, decidedBy)}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {!done && decide === "approve" && (
          <>
            <button type="button" onClick={() => setAsking("approve")} className={`${btn} bg-[#341D2B] text-on-brand ring-transparent`}>
              {A.approve}
            </button>
            <button type="button" onClick={() => setAsking("reject")} className={`${btn} bg-red-50 text-red-800 ring-red-300`}>
              {A.reject}
            </button>
          </>
        )}
        {canWarn && (
          <button type="button" onClick={() => setPanel(panel === "warn" ? "none" : "warn")} className={`${btn} bg-white text-black/75 ring-black/10`}>
            {A.warn}
          </button>
        )}
        {canCertify && (
          <button type="button" onClick={() => setPanel(panel === "certificate" ? "none" : "certificate")} className={`${btn} bg-white text-black/75 ring-black/10`}>
            {A.certificate}
          </button>
        )}
      </div>

      {panel === "warn" && (
        <div className="mt-3 border-t border-black/5 pt-3">
          <WarningForm memberId={member.id} theme={theme} onDone={() => setPanel("none")} />
        </div>
      )}
      {panel === "certificate" && (
        <div className="mt-3 border-t border-black/5 pt-3">
          <CertificateAction type="appreciation" mode="issue" memberId={member.id} name={member.fullName} />
        </div>
      )}

      <ConfirmDialog
        open={asking !== null}
        title={fmt(asking === "approve" ? A.approveTitle : A.rejectTitle, member.fullName)}
        body={asking === "approve" ? A.approveBody : A.rejectBody}
        confirmLabel={asking === "approve" ? A.approve : A.reject}
        tone={asking === "approve" ? "brand" : "danger"}
        pending={pending}
        error={error}
        onConfirm={() => asking && run(asking)}
        onCancel={() => setAsking(null)}
      />
    </Card>
  );
}
