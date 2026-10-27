-- فحصُ الناشر الأخير (النص والتصميم معاً قبل النشر) — جدولٌ جديدٌ وحده.
-- إضافيٌّ بالكامل: لا حذفَ ولا إعادةَ تسمية ولا تعديلَ لعمودٍ قائم، ولا يمسّ بياناتٍ موجودة.

-- CreateTable
CREATE TABLE "MarketingFinalCheck" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "returnedTo" TEXT,
    "note" TEXT,
    "publisherId" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingFinalCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingFinalCheck_deliverableId_idx" ON "MarketingFinalCheck"("deliverableId");

-- AddForeignKey
ALTER TABLE "MarketingFinalCheck" ADD CONSTRAINT "MarketingFinalCheck_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFinalCheck" ADD CONSTRAINT "MarketingFinalCheck_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFinalCheck" ADD CONSTRAINT "MarketingFinalCheck_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "MarketingDesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFinalCheck" ADD CONSTRAINT "MarketingFinalCheck_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

