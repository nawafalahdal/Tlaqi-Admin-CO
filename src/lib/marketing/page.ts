import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDictionary, getLocale } from "@/i18n/server";
import { canEnterMarketing, hasCapability, marketingActor, type MkActor } from "./access";
import { canReadArchive } from "./archive";
import { workCampaignsWhere, workCounts } from "./workQueue";
import { unseenNotices } from "./postArchive";

/** رأسُ كلِّ صفحةٍ في وكيل التسويق — يُحسب في الخادم قبل أن يُقرأ شيء.
 *
 *  من لا جلسةَ له يُرسَل إلى الدخول. ومن لا يدخل الوكيلَ يرى «غير موجود» لا
 *  «ممنوع»: وجودُ الوكيل نفسه لا يُكشف لمن ليس في الفريق. والقائمةُ الجانبية
 *  تسأل السؤالَ نفسه (`canEnterMarketing`)، فلا رابطَ يُعرض وتردّه الصفحة. */
export async function marketingPage(path: string) {
  const session = await auth();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  const actor = await marketingActor(session);
  if (!actor || !canEnterMarketing(actor)) notFound();
  const locale = await getLocale();
  const t = getDictionary(locale);
  // صفحاتُ العمل وأعدادُها لمن يعمل في الحملات — ثلاثةُ عدٍّ مفهرسة، بلا قراءةٍ للأرشيف
  const [work, notices] = await Promise.all([workCampaignsWhere(actor) ? workCounts(actor) : Promise.resolve(null), unseenNotices(actor)]);
  return { session, actor: actor as MkActor, locale, t, mk: t.mk, isManager: hasCapability(actor, "manager"), canArchive: canReadArchive(actor), work, notices };
}
