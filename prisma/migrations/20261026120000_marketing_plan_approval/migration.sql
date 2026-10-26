-- سلسلةُ اعتماد خطة الحملة: قائدُ التسويق ← مسؤولُ التشغيل ← الرئيسُ التنفيذي.
-- إضافيٌّ بحت، ولا يمسّ إلا جداولَ وكيل التسويق: نوعٌ وجدولان جديدان، وعمودٌ اختياريٌّ في MarketingCampaign.

-- CreateEnum
CREATE TYPE "MarketingPlanStage" AS ENUM ('department', 'operations', 'executive');

-- AlterTable
ALTER TABLE "MarketingCampaign" ADD COLUMN     "currentPlanVersionId" TEXT;

-- CreateTable
CREATE TABLE "MarketingPlanVersion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "note" TEXT,
    "submittedById" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanDecision" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "stage" "MarketingPlanStage" NOT NULL,
    "decision" "MarketingDecision" NOT NULL,
    "note" TEXT,
    "deciderId" TEXT NOT NULL,
    "deciderName" TEXT NOT NULL,
    "deciderRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlanDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlanVersion_campaignId_number_key" ON "MarketingPlanVersion"("campaignId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlanDecision_planVersionId_stage_key" ON "MarketingPlanDecision"("planVersionId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_currentPlanVersionId_key" ON "MarketingCampaign"("currentPlanVersionId");

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_currentPlanVersionId_fkey" FOREIGN KEY ("currentPlanVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanVersion" ADD CONSTRAINT "MarketingPlanVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanVersion" ADD CONSTRAINT "MarketingPlanVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanDecision" ADD CONSTRAINT "MarketingPlanDecision_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

