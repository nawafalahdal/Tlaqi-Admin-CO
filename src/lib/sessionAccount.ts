import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** ما تقوله القاعدة الآن عن صاحب الجلسة — لا ما كُتب في توكنه يوم دخل.
 *
 *  **العطبُ الذي يُصلحه، وهو حادثةُ قائدة التسويق:** الجلسةُ توكنٌ موقَّع، دورُه
 *  وقسمُه كُتبا لحظةَ الدخول ولا يتغيّران بعدها. والمرشّحُ القياديُّ يدخل قبل اعتماده
 *  بسجلّ ترشّحه (`Member`) ليختبر — فإن بقي داخلاً حتى اعتُمد، بقي «عضواً» في كل
 *  صفحةٍ وكل إجراء، وحسابُه الإداريُّ قائمٌ لا يصل إليه: الهيكلُ يُريه قائداً وجلستُه
 *  تُريه عضواً. و«تذكّرني» تُبقيه كذلك ثلاثين يوماً، والعملُ المتصل يُبقيه بلا نهاية.
 *  وكان الفحصُ الدوريّ يسأل «أما يزال الحسابُ نشطاً؟» وحدها.
 *
 *  فصار يسأل عن الحساب كلِّه:
 *  - `gone`: حُذف أو عُطِّل — تُبطَل الجلسة (كما كانت).
 *  - `superseded`: سجلُّ ترشّحٍ صار لصاحبه حسابٌ إداريٌّ نشط بالبريد نفسه — تُبطَل
 *    الجلسة، فيدخل من جديد بالكلمة نفسها (نُقلت إلى حسابه عند الاعتماد) ويصل حسابَه.
 *  - `live`: الدورُ والقسمُ الحاليّان من القاعدة — يحلّان محلّ ما في التوكن، فمن نُقل
 *    أو تغيّر منصبُه يُعامَل بحاله الآن في كل ما يقرأ الجلسة.
 *  - `unknown`: تعذّرت القراءة — انقطاعُ القاعدة لحظةً ليس حذفاً، فلا تُمسّ الجلسة.
 *
 *  ولا يُنقَل التوكنُ من هويةٍ إلى أخرى في مكانه عمداً: الدخولُ من جديد هو ما يُثبت
 *  صاحبَ الحساب الإداري بكلمته ورمز بريده. */
export type SessionAccount =
  | { status: "live"; role: UserRole | "member"; departmentId: string | null; departmentSlug: string | null; leadershipCandidate: boolean }
  | { status: "gone" }
  | { status: "superseded" }
  | { status: "unknown" };

export async function resolveSessionAccount(sub: unknown, role: unknown): Promise<SessionAccount> {
  if (typeof sub !== "string" || !sub) return { status: "gone" };
  try {
    if (role === "member") {
      const m = await prisma.member.findUnique({
        where: { id: sub },
        select: {
          isActive: true,
          email: true,
          departmentId: true,
          department: { select: { slug: true } },
          invite: { select: { targetRole: true } },
        },
      });
      if (!m?.isActive) return { status: "gone" };
      // البريدُ هو ما يصل سجلَّ الترشّح بالحساب الإداري الذي أُنشئ منه (`approveMember`)
      const leader = await prisma.user.findUnique({ where: { email: m.email }, select: { isActive: true } });
      if (leader?.isActive) return { status: "superseded" };
      return {
        status: "live",
        role: "member",
        departmentId: m.departmentId,
        departmentSlug: m.department?.slug ?? null,
        leadershipCandidate: m.invite.targetRole !== "member",
      };
    }
    const u = await prisma.user.findUnique({
      where: { id: sub },
      select: { isActive: true, role: true, departmentId: true, department: { select: { slug: true } } },
    });
    if (!u?.isActive) return { status: "gone" };
    return {
      status: "live",
      role: u.role,
      departmentId: u.departmentId,
      departmentSlug: u.department?.slug ?? null,
      leadershipCandidate: false,
    };
  } catch {
    return { status: "unknown" };
  }
}
