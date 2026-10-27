-- وكيلُ التسويق: الخطةُ التنفيذية، وتقويمُ النشر وسجلُّ تعديله، وموجزُ التصميم، والشات،
-- ودورةُ التخطيط، وسجلُّ الأرشفة.
-- **إضافيٌّ كلُّه:** أنواعٌ وجداولُ جديدة، وأعمدةٌ اختيارية (أو بقيمةٍ افتراضية) في جداول الوكيل وحدها.
-- لا حذفَ ولا إعادةَ تسمية ولا تغييرَ لعمودٍ قائم، ولا يمسّ جدولاً خارج Marketing*.

-- CreateEnum
CREATE TYPE "MarketingChatKind" AS ENUM ('planning', 'content', 'design', 'publishing');

-- CreateEnum
CREATE TYPE "MarketingChatRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "MarketingChatStatus" AS ENUM ('queued', 'running', 'done', 'failed', 'cancelled', 'stale');

-- CreateEnum
CREATE TYPE "MarketingArchiveStatus" AS ENUM ('pending', 'writing', 'verified', 'deleting', 'completed', 'failed');

-- AlterTable
ALTER TABLE "MarketingCampaign" ADD COLUMN     "audienceSegments" TEXT,
ADD COLUMN     "budgetAmount" INTEGER,
ADD COLUMN     "budgetNote" TEXT,
ADD COLUMN     "kpis" JSONB,
ADD COLUMN     "measurement" TEXT,
ADD COLUMN     "outcomes" TEXT,
ADD COLUMN     "references" TEXT,
ADD COLUMN     "risks" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh';

-- AlterTable
ALTER TABLE "MarketingDeliverable" ADD COLUMN     "contentDueAt" TIMESTAMP(3),
ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "cta" TEXT,
ADD COLUMN     "designDueAt" TIMESTAMP(3),
ADD COLUMN     "designerId" TEXT,
ADD COLUMN     "kpi" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "publishBasis" TEXT,
ADD COLUMN     "publishBasisNote" TEXT,
ADD COLUMN     "reviewDueAt" TIMESTAMP(3),
ADD COLUMN     "topic" TEXT,
ADD COLUMN     "unpublishedReason" TEXT,
ADD COLUMN     "writerId" TEXT;

-- AlterTable
ALTER TABLE "MarketingPlanVersion" ADD COLUMN     "scheduleFingerprint" TEXT;

-- AlterTable
ALTER TABLE "MarketingPublication" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "MarketingSettings" ADD COLUMN     "aiPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiPausedByName" TEXT;

-- AlterTable
ALTER TABLE "MarketingTask" ADD COLUMN     "planVersionId" TEXT;

-- CreateTable
CREATE TABLE "MarketingDesignBrief" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "placement" TEXT,
    "outputType" TEXT,
    "headline" TEXT,
    "secondaryText" TEXT,
    "cta" TEXT,
    "logoPosition" TEXT,
    "logoSize" TEXT,
    "logoSafeMargin" TEXT,
    "fonts" TEXT,
    "colors" TEXT,
    "background" TEXT,
    "imagery" TEXT,
    "layout" TEXT,
    "contrastNotes" TEXT,
    "direction" TEXT,
    "visualReferences" TEXT,
    "deliveryMethod" TEXT,
    "externalLink" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDesignBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingScheduleChange" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingScheduleChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingChatThread" (
    "id" TEXT NOT NULL,
    "kind" "MarketingChatKind" NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "MarketingChatRole" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "replyToId" TEXT,
    "status" "MarketingChatStatus" NOT NULL DEFAULT 'done',
    "contextFingerprint" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanningCycle" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "reopenAt" TIMESTAMP(3) NOT NULL,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPlanningCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingArchiveRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "status" "MarketingArchiveStatus" NOT NULL DEFAULT 'pending',
    "sheetName" TEXT NOT NULL,
    "expectedRows" INTEGER NOT NULL DEFAULT 0,
    "verifiedRows" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "requestedByName" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingArchiveRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDesignBrief_deliverableId_key" ON "MarketingDesignBrief"("deliverableId");

-- CreateIndex
CREATE INDEX "MarketingScheduleChange_campaignId_createdAt_idx" ON "MarketingScheduleChange"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingChatThread_scopeKey_key" ON "MarketingChatThread"("scopeKey");

-- CreateIndex
CREATE INDEX "MarketingChatThread_campaignId_idx" ON "MarketingChatThread"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingChatMessage_idempotencyKey_key" ON "MarketingChatMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketingChatMessage_threadId_createdAt_idx" ON "MarketingChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingChatMessage_status_nextAttemptAt_idx" ON "MarketingChatMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlanningCycle_campaignId_key" ON "MarketingPlanningCycle"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingPlanningCycle_reopenedAt_reopenAt_idx" ON "MarketingPlanningCycle"("reopenedAt", "reopenAt");

-- CreateIndex
CREATE INDEX "MarketingArchiveRun_campaignId_idx" ON "MarketingArchiveRun"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingArchiveRun_status_nextAttemptAt_idx" ON "MarketingArchiveRun"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "MarketingDeliverable" ADD CONSTRAINT "MarketingDeliverable_writerId_fkey" FOREIGN KEY ("writerId") REFERENCES "MarketingMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDeliverable" ADD CONSTRAINT "MarketingDeliverable_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "MarketingMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDesignBrief" ADD CONSTRAINT "MarketingDesignBrief_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingScheduleChange" ADD CONSTRAINT "MarketingScheduleChange_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingScheduleChange" ADD CONSTRAINT "MarketingScheduleChange_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingChatThread" ADD CONSTRAINT "MarketingChatThread_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingChatThread" ADD CONSTRAINT "MarketingChatThread_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingChatMessage" ADD CONSTRAINT "MarketingChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MarketingChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingChatMessage" ADD CONSTRAINT "MarketingChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "MarketingMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

