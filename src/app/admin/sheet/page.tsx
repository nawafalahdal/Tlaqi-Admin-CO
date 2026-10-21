import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { getLocale, getDictionary } from "@/i18n/server";

/** السجل الحي — للمؤسس وحده، وفيه رابطُ ملف الإكسل لا غير (قرار المؤسس).
 *
 *  كانت الصفحةُ تَعرض أعمدةَ كل تبويبٍ وأدواتَ تهيئة التبويبات والتعبئة.
 *  فصارت مدخلاً واحداً إلى الملف نفسه: ما يُكتب فيه يُقرأ فيه. ولا يُمَسّ
 *  شيءٌ من الكتابة إلى الملف ولا من سجلّاته — الصفحةُ وحدها تغيّرت.
 *
 *  والحرسُ هنا في الخادم: من ليس مؤسساً يُعاد ولو كتب العنوان بيده. */
export default async function SheetPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "super_admin") redirect("/admin");

  const t = getDictionary(await getLocale());
  const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit` : null;

  return (
    <div className="min-h-screen bg-page">

      <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-8">
        <PageHeader title={t.sheetPage.title} description={t.sheetPage.subtitle} />
        <Card className="flex flex-col items-start gap-3 p-5 sm:p-6">
          {sheetUrl ? (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-brand inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-sm font-bold"
            >
              {t.sheetPage.linkLabel} ↗
            </a>
          ) : (
            <p className="text-sm text-red-700">{t.sheetPage.notConfigured}</p>
          )}
        </Card>
      </main>
    </div>
  );
}
