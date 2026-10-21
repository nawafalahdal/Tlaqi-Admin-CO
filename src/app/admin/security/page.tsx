import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SecurityForm } from "./SecurityForm";
import { getLocale, getDictionary } from "@/i18n/server";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";

/** التحقق بخطوتين — صفحةٌ أمنيةٌ لصاحب الحساب داخل مساحة العمل.
 *
 *  كانت تُرسَم صفحةَ دخولٍ منفردةً (شعارٌ في الوسط وبطاقةٌ عائمة) وهي داخل
 *  تخطيط الإدارة، فتظهر القائمة الجانبية بجوار صفحةٍ تتصرّف كأنها خارجها.
 *  فصارت برأس الصفحة الموحّد وبطاقته، والنموذجُ نفسه لم يتغيّر. */
export default async function SecurityPage() {
  const session = await auth();
  if (!session || session.user.role === "member") redirect("/login");

  const t = getDictionary(await getLocale());

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { totpEnabled: true },
  });

  return (
    <div className="min-h-screen bg-page">
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
      <PageHeader title={t.security.title} description={t.misc.securityHint} />
      <Card className="p-5 sm:p-6">
        <SecurityForm initialEnabled={user.totpEnabled} />
      </Card>
    </main>
    </div>
  );
}
