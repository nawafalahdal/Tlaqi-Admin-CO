import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/PageHeader";
import { isDesignatedApprover } from "@/lib/candidateDecision";
import { CandidateApprovals } from "@/app/admin/approvals/CandidateApprovals";

export const dynamic = "force-dynamic";

/** **اعتمادُ العضوية — طابورُ جهة الاعتماد المستقلة** (قرار المؤسس، ق١ وق٢).
 *
 *  لمن يحمل «اعتماد العضوية» في تكليفٍ نشطٍ بالإدارة العليا — عضواً كان أو حساباً إدارياً — وليس مؤسساً ولا رئيساً
 *  تنفيذياً (`isDesignatedApprover` من القاعدة). يحسم المرشّحين للمناصب القيادية، وأعضاءَ الإدارة العليا، وأعضاءَ قسمٍ
 *  لا قائدَ له. والخادمُ يفرض الشرطَ ذاته عند كل قرار (`mayDecideCandidate`). */
export default async function SeniorApprovalsPage() {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=%2Fsenior%2Fapprovals");
  if (!(await isDesignatedApprover(session))) redirect(session.user.role === "member" ? "/member" : "/admin");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="اعتماد العضوية"
        description="جهةُ الاعتماد المستقلة: تحسم المرشّحين للمناصب القيادية، وأعضاءَ الإدارة العليا، وأعضاءَ قسمٍ لا قائدَ له — بعد اجتيازهم الاختبار. والمؤسسُ والرئيسُ التنفيذيُّ يطّلعان على النتائج ولا يحسمانها."
      />
      <CandidateApprovals session={session} />
    </div>
  );
}
