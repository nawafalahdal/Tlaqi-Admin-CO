-- مفتاحُ منع تكرار الالتزام (البند ٤): عمودٌ اختياريٌّ فريد — إضافةٌ فقط، والصفوفُ القائمة فارغةٌ فيه.

-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PlanTask_clientRequestId_key" ON "PlanTask"("clientRequestId");

