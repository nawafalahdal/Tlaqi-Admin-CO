import { auth } from "@/auth";
import { AppSidebar } from "@/components/sidebar/AppSidebar";

/** تغييرُ كلمة المرور داخل مساحة العمل — إلا حين يكون إجبارياً.
 *
 *  كانت الصفحةُ خارج كل تخطيطٍ فيه القائمة، فيُفتح «تغيير كلمة المرور»
 *  من قائمة الحساب فتختفي القائمة الجانبية كلُّها، ويعود من رجع إليها إلى
 *  قائمةٍ ممرَّرةٍ إلى أعلاها.
 *
 *  **والإجباريُّ يبقى بلا قائمة:** من وجب عليه تغييرُها لا يصل غيرَ هذه
 *  الصفحة (`proxy.ts` يُعيده إليها)، فعرضُ روابطَ لا تُفتح له وعدٌ كاذب. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.mustChangePassword) return <>{children}</>;
  return <AppSidebar>{children}</AppSidebar>;
}
