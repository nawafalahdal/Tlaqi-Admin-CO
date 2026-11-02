-- فصلُ قيادة اللجنة عن قيادة القسم — إضافيٌّ بالكامل: عمودان قابلان للفراغ وفهرسٌ فريد.
-- لا يُغيّر صفّاً قائماً ولا يحذف شيئاً. التحويلُ نفسُه إجراءٌ في التطبيق يطبّقه المؤسس حالةً حالة.

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "convertedFromUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Member_convertedFromUserId_key" ON "Member"("convertedFromUserId");
