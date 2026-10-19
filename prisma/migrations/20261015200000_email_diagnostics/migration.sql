-- جوابُ مزوّد البريد يُحفَظ — وبدونه لا يُعرَف سببُ فشلٍ بعد ساعة.
--
-- سجلُّ Vercel على الخطة المجانية يُبقي ساعةً واحدة، وسجلُّ المنصة كان
-- يَحفظ «فشل الإرسال» بلا سبب. فضاع جوابُ المزوّد — وهو الوحيد الذي
-- يُفيد في معرفة لماذا لم تصل بطاقةُ الانضمام.
-- ولا حذفَ هنا ولا تغييرَ عمودٍ قائم — إضافةٌ محضة.

ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "providerId"    TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "failureKind"   TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "failureDetail" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "attempt"       INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "EmailLog_kind_status_idx" ON "EmailLog" ("kind", "status");
