-- سير عمل التسويق: رقمُ المنشور في حملته، ووصفُ التصميم ورابطُه، وأرشفةُ كل منشورٍ بعد نشره،
-- وإشعاراتٌ تُعرض مرّةً واحدة، ومساعدُ القسم. **إضافيٌّ بالكامل:** لا حذفَ لعمودٍ ولا لجدولٍ ولا
-- لصف؛ وما رُفع عنه شرطُ «غير فارغ» (ملفُّ التصميم وأبعادُه، وحملةُ المحادثة) يبقى كما هو في كل
-- صفٍّ قائم، وقيدٌ يمنع نسخةَ تصميمٍ بلا ملفٍّ ولا رابط.

-- AlterEnum
ALTER TYPE "MarketingChatKind" ADD VALUE 'assistant';

-- AlterTable
ALTER TABLE "MarketingDeliverable" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "designDescription" TEXT,
ADD COLUMN     "seq" INTEGER;

-- AlterTable
ALTER TABLE "MarketingDesignVersion" ADD COLUMN     "description" TEXT,
ADD COLUMN     "linkUrl" TEXT,
ALTER COLUMN "fileId" DROP NOT NULL,
ALTER COLUMN "width" DROP NOT NULL,
ALTER COLUMN "height" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MarketingChatThread" ADD COLUMN     "ownerId" TEXT,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- رقمُ المنشور للقائم: بترتيب إنشائه في حملته (١، ٢، …) — قبل قيد التفرّد
UPDATE "MarketingDeliverable" AS d
SET "seq" = r.n
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "campaignId" ORDER BY "createdAt", "id") AS n FROM "MarketingDeliverable") AS r
WHERE d."id" = r."id";

-- نسخةُ التصميم ملفٌّ أو رابط — واحدٌ منهما على الأقل (كلُّ صفٍّ قائمٍ له ملف)
ALTER TABLE "MarketingDesignVersion" ADD CONSTRAINT "MarketingDesignVersion_file_or_link" CHECK ("fileId" IS NOT NULL OR "linkUrl" IS NOT NULL);

-- CreateTable
CREATE TABLE "MarketingPostArchive" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "MarketingArchiveStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "expectedRows" INTEGER NOT NULL DEFAULT 0,
    "verifiedRows" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPostArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingNotice" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "campaignId" TEXT,
    "deliverableId" TEXT,
    "params" JSONB NOT NULL,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPostArchive_deliverableId_key" ON "MarketingPostArchive"("deliverableId");

-- CreateIndex
CREATE INDEX "MarketingPostArchive_status_nextAttemptAt_idx" ON "MarketingPostArchive"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketingPostArchive_campaignId_idx" ON "MarketingPostArchive"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingNotice_memberId_seenAt_idx" ON "MarketingNotice"("memberId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingNotice_memberId_kind_deliverableId_key" ON "MarketingNotice"("memberId", "kind", "deliverableId");

-- CreateIndex
CREATE INDEX "MarketingDeliverable_archivedAt_status_idx" ON "MarketingDeliverable"("archivedAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDeliverable_campaignId_seq_key" ON "MarketingDeliverable"("campaignId", "seq");

-- AddForeignKey
ALTER TABLE "MarketingChatThread" ADD CONSTRAINT "MarketingChatThread_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MarketingMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPostArchive" ADD CONSTRAINT "MarketingPostArchive_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingNotice" ADD CONSTRAINT "MarketingNotice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MarketingMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

