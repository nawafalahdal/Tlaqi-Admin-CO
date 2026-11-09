-- استبيانُ الانضمام + سجلُّ إغلاق الطلبات + سجلُّ التصدير — إضافيٌّ بالكامل:
-- أعمدةٌ جديدةٌ تقبل الفراغ (أو بقيمةٍ افتراضية) وجدولان جديدان. لا يُحذف ولا يُعدَّل صفٌّ قائم.

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "onboardingSurveyRequiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "closeNote" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedAutomatically" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "closedByName" TEXT;

-- CreateTable
CREATE TABLE "OnboardingSurveyResponse" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "journeyRating" INTEGER NOT NULL,
    "roleClarityRating" INTEGER NOT NULL,
    "bannerReceived" BOOLEAN NOT NULL,
    "gender" "Gender" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "reopenedByName" TEXT,
    "reopenReason" TEXT,
    "followUpResolvedAt" TIMESTAMP(3),
    "followUpResolvedByName" TEXT,
    "followUpNote" TEXT,

    CONSTRAINT "OnboardingSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingSurveyResponse_memberId_submittedAt_idx" ON "OnboardingSurveyResponse"("memberId", "submittedAt");

-- CreateIndex
CREATE INDEX "OnboardingSurveyResponse_submittedAt_idx" ON "OnboardingSurveyResponse"("submittedAt");

-- CreateIndex
CREATE INDEX "DataExportLog_kind_createdAt_idx" ON "DataExportLog"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "OnboardingSurveyResponse" ADD CONSTRAINT "OnboardingSurveyResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- التقييمُ من 1 إلى 5 — يُفرَض في القاعدة نفسها لا في الواجهة وحدها
ALTER TABLE "OnboardingSurveyResponse" ADD CONSTRAINT "OnboardingSurveyResponse_journeyRating_range" CHECK ("journeyRating" BETWEEN 1 AND 5);
ALTER TABLE "OnboardingSurveyResponse" ADD CONSTRAINT "OnboardingSurveyResponse_roleClarityRating_range" CHECK ("roleClarityRating" BETWEEN 1 AND 5);
