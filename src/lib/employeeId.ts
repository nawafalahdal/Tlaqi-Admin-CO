import type { Prisma, PrismaClient } from "@prisma/client";

/** **الرقمُ الوظيفي** (قرار المؤسس، نوفمبر 2026) — لكل موظفٍ رقمٌ واحد من تسلسلٍ واحد (`User_employeeNo_seq`)، بدأ بالمؤسس 001
 *  ثم القائمون بتاريخ انضمامهم (الترحيل `20261113180000_employee_numbers`).
 *
 *  - **الحسابُ الإداري** يأخذ رقمه تلقائياً عند إنشائه (قيمةُ العمود الافتراضية)، ويرث رقمَ سجلّ عضويته إن كان له.
 *  - **العضو** يأخذه عند الاعتماد لا عند الدعوة — المرشّحُ ليس موظفاً بعد، ومن لم يجتز لا يستهلك رقماً.
 *  - **الشخصُ الواحد رقمٌ واحد:** من رُقّي أو أُعيد عضواً يحمل رقمَه في السجلّين. ولا يُعاد استعمالُ رقمٍ أبداً. */
type Db = PrismaClient | Prisma.TransactionClient;

/** `TLAQI - 001` — ثلاثُ خاناتٍ على الأقل، كما في بطاقات الجهات */
export function employeeIdLabel(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  return `TLAQI - ${String(n).padStart(3, "0")}`;
}

/** يُسنِد رقماً لعضوٍ إن لم يكن له: يرث `carry` (رقمَ حسابه الإداري) إن وُجد، وإلا التالي في التسلسل */
export async function assignMemberEmployeeNo(db: Db, memberId: string, carry?: number | null) {
  if (carry !== null && carry !== undefined) {
    await db.member.updateMany({ where: { id: memberId, employeeNo: null }, data: { employeeNo: carry } });
    return;
  }
  await db.$executeRaw`UPDATE "Member" SET "employeeNo" = nextval('"User_employeeNo_seq"') WHERE "id" = ${memberId} AND "employeeNo" IS NULL`;
}

/** يُسنِد رقماً لحسابٍ إداري (أُعيد تفعيلُه مثلاً) إن لم يكن له: يرث `carry` إن وُجد، وإلا التالي في التسلسل */
export async function assignUserEmployeeNo(db: Db, userId: string, carry?: number | null) {
  if (carry !== null && carry !== undefined) {
    await db.user.updateMany({ where: { id: userId, employeeNo: null }, data: { employeeNo: carry } });
    return;
  }
  await db.$executeRaw`UPDATE "User" SET "employeeNo" = nextval('"User_employeeNo_seq"') WHERE "id" = ${userId} AND "employeeNo" IS NULL`;
}
