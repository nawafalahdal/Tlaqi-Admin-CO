-- اختبارٌ لعضوٍ قائم (قرار المؤسس، نوفمبر 2026 — ١.٢ وق٧): جدولان جديدان وأنواعهما — إضافاتٌ فقط، لا يتغيّر شيءٌ قائم.


-- CreateEnum
CREATE TYPE "AssessmentPurpose" AS ENUM ('evaluation', 'senior_position');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('assigned', 'passed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "AssessmentAssignment" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "userId" TEXT,
    "trackId" TEXT NOT NULL,
    "purpose" "AssessmentPurpose" NOT NULL,
    "reason" TEXT NOT NULL,
    "seniorPositionId" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'assigned',
    "score" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByName" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "AssessmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentAssignment_memberId_status_idx" ON "AssessmentAssignment"("memberId", "status");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_userId_status_idx" ON "AssessmentAssignment"("userId", "status");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_seniorPositionId_idx" ON "AssessmentAssignment"("seniorPositionId");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_assignmentId_idx" ON "AssessmentAttempt"("assignmentId");

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "TestTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_seniorPositionId_fkey" FOREIGN KEY ("seniorPositionId") REFERENCES "SeniorPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssessmentAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

