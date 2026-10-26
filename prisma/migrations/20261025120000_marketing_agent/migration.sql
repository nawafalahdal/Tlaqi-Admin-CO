-- وكيلُ التسويق الداخلي: جداولُ جديدةٌ فقط — لا تغييرَ في جدولٍ قائم.

-- CreateEnum
CREATE TYPE "MarketingCapability" AS ENUM ('manager', 'coordinator', 'writer', 'designer', 'reviewer', 'publisher');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('idea', 'briefing', 'ready_for_planning', 'in_progress', 'blocked', 'published', 'archived');

-- CreateEnum
CREATE TYPE "MarketingCampaignRole" AS ENUM ('coordinator', 'writer', 'designer', 'reviewer', 'publisher');

-- CreateEnum
CREATE TYPE "MarketingDeliverableStatus" AS ENUM ('draft', 'content_review', 'content_approved', 'design_review', 'design_approved', 'quality_review', 'ready_to_publish', 'published', 'revision_required', 'blocked');

-- CreateEnum
CREATE TYPE "MarketingRevisionTarget" AS ENUM ('content', 'design');

-- CreateEnum
CREATE TYPE "MarketingApprovalKind" AS ENUM ('content', 'design');

-- CreateEnum
CREATE TYPE "MarketingDecision" AS ENUM ('approved', 'changes_requested');

-- CreateEnum
CREATE TYPE "MarketingTaskKind" AS ENUM ('general', 'content', 'design', 'quality', 'publishing');

-- CreateEnum
CREATE TYPE "MarketingTaskStatus" AS ENUM ('todo', 'in_progress', 'blocked', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "MarketingFileKind" AS ENUM ('design', 'attachment');

-- CreateEnum
CREATE TYPE "MarketingJobKind" AS ENUM ('text', 'image');

-- CreateEnum
CREATE TYPE "MarketingJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "MarketingMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "memberId" TEXT,
    "capabilities" "MarketingCapability"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "audience" TEXT,
    "keyMessage" TEXT,
    "channels" TEXT[],
    "deadline" TIMESTAMP(3),
    "priority" "WorkPriority" NOT NULL DEFAULT 'normal',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'idea',
    "statusBeforeBlock" "MarketingCampaignStatus",
    "blockedReason" TEXT,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignMember" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" "MarketingCampaignRole" NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingCampaignMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFormat" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "safeTop" INTEGER NOT NULL DEFAULT 0,
    "safeRight" INTEGER NOT NULL DEFAULT 0,
    "safeBottom" INTEGER NOT NULL DEFAULT 0,
    "safeLeft" INTEGER NOT NULL DEFAULT 0,
    "platforms" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDeliverable" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "formatKey" TEXT NOT NULL,
    "formatRevision" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "safeTop" INTEGER NOT NULL,
    "safeRight" INTEGER NOT NULL,
    "safeBottom" INTEGER NOT NULL,
    "safeLeft" INTEGER NOT NULL,
    "status" "MarketingDeliverableStatus" NOT NULL DEFAULT 'draft',
    "statusBeforeBlock" "MarketingDeliverableStatus",
    "revisionTarget" "MarketingRevisionTarget",
    "revisionNote" TEXT,
    "contentDraft" TEXT NOT NULL DEFAULT '',
    "draftUpdatedAt" TIMESTAMP(3),
    "currentContentVersionId" TEXT,
    "currentDesignVersionId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentVersion" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "changeNote" TEXT,
    "sources" TEXT,
    "authorId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDesignVersion" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "basedOnContentVersionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "changeNote" TEXT,
    "authorId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDesignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingApproval" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "kind" "MarketingApprovalKind" NOT NULL,
    "contentVersionId" TEXT,
    "designVersionId" TEXT,
    "decision" "MarketingDecision" NOT NULL,
    "note" TEXT,
    "deciderId" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingQualityCheck" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "reviewerId" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingQualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPublication" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "publisherId" TEXT NOT NULL,
    "metrics" JSONB,
    "metricsAsOf" TIMESTAMP(3),
    "metricsSource" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTask" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "kind" "MarketingTaskKind" NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "WorkPriority" NOT NULL DEFAULT 'normal',
    "status" "MarketingTaskStatus" NOT NULL DEFAULT 'todo',
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "MarketingTaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "MarketingComment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "taskId" TEXT,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingFile" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "taskId" TEXT,
    "kind" "MarketingFileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "deliverableId" TEXT,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingGenerationJob" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "kind" "MarketingJobKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" "MarketingJobStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "adoptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "requireSeparateApprover" BOOLEAN NOT NULL DEFAULT true,
    "updatedByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMember_userId_key" ON "MarketingMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMember_memberId_key" ON "MarketingMember"("memberId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE INDEX "MarketingCampaignMember_memberId_idx" ON "MarketingCampaignMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaignMember_campaignId_memberId_role_key" ON "MarketingCampaignMember"("campaignId", "memberId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingFormat_key_key" ON "MarketingFormat"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDeliverable_currentContentVersionId_key" ON "MarketingDeliverable"("currentContentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDeliverable_currentDesignVersionId_key" ON "MarketingDeliverable"("currentDesignVersionId");

-- CreateIndex
CREATE INDEX "MarketingDeliverable_campaignId_idx" ON "MarketingDeliverable"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingDeliverable_status_idx" ON "MarketingDeliverable"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentVersion_idempotencyKey_key" ON "MarketingContentVersion"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentVersion_deliverableId_number_key" ON "MarketingContentVersion"("deliverableId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDesignVersion_fileId_key" ON "MarketingDesignVersion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDesignVersion_idempotencyKey_key" ON "MarketingDesignVersion"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDesignVersion_deliverableId_number_key" ON "MarketingDesignVersion"("deliverableId", "number");

-- CreateIndex
CREATE INDEX "MarketingApproval_deliverableId_kind_idx" ON "MarketingApproval"("deliverableId", "kind");

-- CreateIndex
CREATE INDEX "MarketingQualityCheck_deliverableId_idx" ON "MarketingQualityCheck"("deliverableId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPublication_idempotencyKey_key" ON "MarketingPublication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketingPublication_deliverableId_idx" ON "MarketingPublication"("deliverableId");

-- CreateIndex
CREATE INDEX "MarketingTask_campaignId_idx" ON "MarketingTask"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingTask_assigneeId_status_idx" ON "MarketingTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "MarketingComment_campaignId_createdAt_idx" ON "MarketingComment"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingFile_campaignId_idx" ON "MarketingFile"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingEvent_campaignId_createdAt_idx" ON "MarketingEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_createdAt_idx" ON "MarketingEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingGenerationJob_idempotencyKey_key" ON "MarketingGenerationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketingGenerationJob_status_nextAttemptAt_idx" ON "MarketingGenerationJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketingGenerationJob_deliverableId_idx" ON "MarketingGenerationJob"("deliverableId");

-- AddForeignKey
ALTER TABLE "MarketingMember" ADD CONSTRAINT "MarketingMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMember" ADD CONSTRAINT "MarketingMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignMember" ADD CONSTRAINT "MarketingCampaignMember_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignMember" ADD CONSTRAINT "MarketingCampaignMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDeliverable" ADD CONSTRAINT "MarketingDeliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDeliverable" ADD CONSTRAINT "MarketingDeliverable_currentContentVersionId_fkey" FOREIGN KEY ("currentContentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDeliverable" ADD CONSTRAINT "MarketingDeliverable_currentDesignVersionId_fkey" FOREIGN KEY ("currentDesignVersionId") REFERENCES "MarketingDesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentVersion" ADD CONSTRAINT "MarketingContentVersion_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentVersion" ADD CONSTRAINT "MarketingContentVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDesignVersion" ADD CONSTRAINT "MarketingDesignVersion_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDesignVersion" ADD CONSTRAINT "MarketingDesignVersion_basedOnContentVersionId_fkey" FOREIGN KEY ("basedOnContentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDesignVersion" ADD CONSTRAINT "MarketingDesignVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MarketingFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDesignVersion" ADD CONSTRAINT "MarketingDesignVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingApproval" ADD CONSTRAINT "MarketingApproval_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingApproval" ADD CONSTRAINT "MarketingApproval_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingApproval" ADD CONSTRAINT "MarketingApproval_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "MarketingDesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingApproval" ADD CONSTRAINT "MarketingApproval_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingQualityCheck" ADD CONSTRAINT "MarketingQualityCheck_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingQualityCheck" ADD CONSTRAINT "MarketingQualityCheck_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingQualityCheck" ADD CONSTRAINT "MarketingQualityCheck_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "MarketingDesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingQualityCheck" ADD CONSTRAINT "MarketingQualityCheck_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPublication" ADD CONSTRAINT "MarketingPublication_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPublication" ADD CONSTRAINT "MarketingPublication_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPublication" ADD CONSTRAINT "MarketingPublication_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "MarketingDesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPublication" ADD CONSTRAINT "MarketingPublication_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "MarketingMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTask" ADD CONSTRAINT "MarketingTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTaskDependency" ADD CONSTRAINT "MarketingTaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTaskDependency" ADD CONSTRAINT "MarketingTaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "MarketingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingComment" ADD CONSTRAINT "MarketingComment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingComment" ADD CONSTRAINT "MarketingComment_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingComment" ADD CONSTRAINT "MarketingComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingComment" ADD CONSTRAINT "MarketingComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFile" ADD CONSTRAINT "MarketingFile_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFile" ADD CONSTRAINT "MarketingFile_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFile" ADD CONSTRAINT "MarketingFile_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingFile" ADD CONSTRAINT "MarketingFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingGenerationJob" ADD CONSTRAINT "MarketingGenerationJob_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "MarketingDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingGenerationJob" ADD CONSTRAINT "MarketingGenerationJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "MarketingMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- عضوُ فريق التسويق حسابٌ واحد: إداريٌّ أو عضو، لا كلاهما ولا أيٌّ منهما
ALTER TABLE "MarketingMember" ADD CONSTRAINT "MarketingMember_one_principal"
  CHECK (("userId" IS NOT NULL) <> ("memberId" IS NOT NULL));

-- اعتمادُ النص يحمل نسخةَ نص، واعتمادُ التصميم يحمل نسخةَ تصميم
ALTER TABLE "MarketingApproval" ADD CONSTRAINT "MarketingApproval_target_matches_kind"
  CHECK (("kind" = 'content' AND "contentVersionId" IS NOT NULL AND "designVersionId" IS NULL)
      OR ("kind" = 'design' AND "designVersionId" IS NOT NULL));

-- المقاساتُ الابتدائية — قيمٌ قابلةٌ للتعديل من إعدادات الفريق، لا ادّعاءَ أنها تناسب كلَّ منصة
INSERT INTO "MarketingFormat" ("id", "key", "nameAr", "nameEn", "width", "height", "safeTop", "safeRight", "safeBottom", "safeLeft", "platforms", "active", "revision", "updatedByName", "createdAt", "updatedAt") VALUES
  ('mkfmt_story',     'story',     'ستوري',        'Story',          1080, 1920, 250, 60, 250, 60, ARRAY['instagram','facebook','snapchat','tiktok'], true, 1, 'النظام', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mkfmt_portrait',  'portrait',  'منشور رأسي',   'Portrait post',  1080, 1350,  60, 60,  60, 60, ARRAY['instagram','facebook','linkedin'], true, 1, 'النظام', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mkfmt_square',    'square',    'منشور مربع',   'Square post',    1080, 1080,  60, 60,  60, 60, ARRAY['instagram','facebook','x','linkedin'], true, 1, 'النظام', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mkfmt_landscape', 'landscape', 'تصميم أفقي',   'Landscape',      1920, 1080,  60, 90,  60, 90, ARRAY['youtube','x','linkedin','website'], true, 1, 'النظام', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "MarketingSettings" ("id", "requireSeparateApprover", "updatedByName", "updatedAt")
VALUES ('default', true, 'النظام', CURRENT_TIMESTAMP);
