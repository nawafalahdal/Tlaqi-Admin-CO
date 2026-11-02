-- ═══════════════════════════════════════════════════════════════════════
-- الهيكلُ التنظيمي واللجان — ترحيلٌ إضافيٌّ خالص.
--
-- لا حذفَ ولا إعادةَ تسمية ولا تغييرَ نوع: قيمٌ جديدة في تعداد حالة اللجنة،
-- وأعمدةٌ اختيارية في "Department"، وجداولُ جديدة، ونسخٌ واحدٌ في آخره
-- (عضوياتُ اللجان القائمة). والرجوعُ عنه بالشيفرة وحدها لا يكسر شيئاً:
-- الشيفرةُ القديمة لا تقرأ هذه الأعمدة ولا الجداول.
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "CommitteeKind" AS ENUM ('permanent', 'temporary');

-- CreateEnum
CREATE TYPE "DeputyPermission" AS ENUM ('committees_manage', 'members_view', 'responsibilities_assign', 'tasks_view');

-- CreateEnum
CREATE TYPE "CommitteeMeetingStatus" AS ENUM ('scheduled', 'held', 'cancelled');

-- CreateEnum
CREATE TYPE "CommitteeAttendanceStatus" AS ENUM ('present', 'absent', 'excused');

-- CreateEnum
CREATE TYPE "CommitteeDecisionKind" AS ENUM ('decision', 'recommendation', 'note');

-- CreateEnum
CREATE TYPE "CommitteeTaskStatus" AS ENUM ('todo', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "CommitteeTaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "CommitteeProposalKind" AS ENUM ('add_member', 'remove_member', 'replace_member');

-- CreateEnum
CREATE TYPE "CommitteeProposalStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommitteeStatus" ADD VALUE 'draft';
ALTER TYPE "CommitteeStatus" ADD VALUE 'suspended';
ALTER TYPE "CommitteeStatus" ADD VALUE 'completed';
ALTER TYPE "CommitteeStatus" ADD VALUE 'closed';
ALTER TYPE "CommitteeStatus" ADD VALUE 'archived';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "committeeKind" "CommitteeKind",
ADD COLUMN     "deputyAppointedAt" TIMESTAMP(3),
ADD COLUMN     "deputyAppointedByName" TEXT,
ADD COLUMN     "deputyMemberId" TEXT,
ADD COLUMN     "deputyPermissions" "DeputyPermission"[] DEFAULT ARRAY[]::"DeputyPermission"[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "expectedOutputs" TEXT,
ADD COLUMN     "kpis" TEXT,
ADD COLUMN     "leadMemberId" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "responsibilities" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusNote" TEXT;

-- CreateTable
CREATE TABLE "CommitteeMembership" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "responsibility" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByName" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedByName" TEXT,

    CONSTRAINT "CommitteeMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeMeeting" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "location" TEXT,
    "meetingUrl" TEXT,
    "agenda" TEXT,
    "status" "CommitteeMeetingStatus" NOT NULL DEFAULT 'scheduled',
    "minutes" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT NOT NULL,

    CONSTRAINT "CommitteeMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeAttendance" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "CommitteeAttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByName" TEXT NOT NULL,

    CONSTRAINT "CommitteeAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeDecision" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "meetingId" TEXT,
    "kind" "CommitteeDecisionKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT NOT NULL,

    CONSTRAINT "CommitteeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeTask" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "meetingId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeMemberId" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "CommitteeTaskPriority" NOT NULL DEFAULT 'normal',
    "status" "CommitteeTaskStatus" NOT NULL DEFAULT 'todo',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitteeTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeReport" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "achievements" TEXT,
    "challenges" TEXT,
    "nextSteps" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByName" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByName" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "CommitteeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeProposal" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "kind" "CommitteeProposalKind" NOT NULL,
    "memberId" TEXT,
    "replacementMemberId" TEXT,
    "note" TEXT,
    "status" "CommitteeProposalStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedByName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByName" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "CommitteeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAuditEvent" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeMembership_memberId_active_idx" ON "CommitteeMembership"("memberId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeMembership_committeeId_memberId_key" ON "CommitteeMembership"("committeeId", "memberId");

-- CreateIndex
CREATE INDEX "CommitteeMeeting_committeeId_startsAt_idx" ON "CommitteeMeeting"("committeeId", "startsAt");

-- CreateIndex
CREATE INDEX "CommitteeMeeting_startsAt_idx" ON "CommitteeMeeting"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeAttendance_meetingId_memberId_key" ON "CommitteeAttendance"("meetingId", "memberId");

-- CreateIndex
CREATE INDEX "CommitteeDecision_committeeId_createdAt_idx" ON "CommitteeDecision"("committeeId", "createdAt");

-- CreateIndex
CREATE INDEX "CommitteeTask_committeeId_status_idx" ON "CommitteeTask"("committeeId", "status");

-- CreateIndex
CREATE INDEX "CommitteeTask_assigneeMemberId_status_idx" ON "CommitteeTask"("assigneeMemberId", "status");

-- CreateIndex
CREATE INDEX "CommitteeTask_dueAt_idx" ON "CommitteeTask"("dueAt");

-- CreateIndex
CREATE INDEX "CommitteeReport_committeeId_submittedAt_idx" ON "CommitteeReport"("committeeId", "submittedAt");

-- CreateIndex
CREATE INDEX "CommitteeProposal_committeeId_status_idx" ON "CommitteeProposal"("committeeId", "status");

-- CreateIndex
CREATE INDEX "OrgAuditEvent_entityId_createdAt_idx" ON "OrgAuditEvent"("entityId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgAuditEvent_departmentId_createdAt_idx" ON "OrgAuditEvent"("departmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Department_deputyMemberId_key" ON "Department"("deputyMemberId");

-- CreateIndex
CREATE INDEX "Department_leadMemberId_idx" ON "Department"("leadMemberId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_leadMemberId_fkey" FOREIGN KEY ("leadMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_deputyMemberId_fkey" FOREIGN KEY ("deputyMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMembership" ADD CONSTRAINT "CommitteeMembership_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMembership" ADD CONSTRAINT "CommitteeMembership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMeeting" ADD CONSTRAINT "CommitteeMeeting_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeAttendance" ADD CONSTRAINT "CommitteeAttendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "CommitteeMeeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeAttendance" ADD CONSTRAINT "CommitteeAttendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeDecision" ADD CONSTRAINT "CommitteeDecision_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeDecision" ADD CONSTRAINT "CommitteeDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "CommitteeMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeTask" ADD CONSTRAINT "CommitteeTask_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeTask" ADD CONSTRAINT "CommitteeTask_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "CommitteeMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeTask" ADD CONSTRAINT "CommitteeTask_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeReport" ADD CONSTRAINT "CommitteeReport_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeProposal" ADD CONSTRAINT "CommitteeProposal_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeProposal" ADD CONSTRAINT "CommitteeProposal_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeProposal" ADD CONSTRAINT "CommitteeProposal_replacementMemberId_fkey" FOREIGN KEY ("replacementMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── نسخُ عضويات اللجان القائمة (إضافةٌ لا نقل)
--
-- في نظام اللجان الأول كان عضوُ اللجنة سجلَّ عضويةٍ قسمُه اللجنةُ نفسُها
-- (`Member.departmentId` = اللجنة). يُكتب لكلٍّ منهم صفُّ عضويةٍ في لجنته،
-- **ولا يُغيَّر قسمُه**. والمرشّحون القياديون خارجها (`targetRole = member`
-- وحده)، والمكرّرُ يُتجاوز (`ON CONFLICT`) فيُعاد تشغيلُه بلا أثر.
INSERT INTO "CommitteeMembership" ("id", "committeeId", "memberId", "active", "addedAt", "addedByName")
SELECT
  'cmb_' || md5(m."id" || ':' || d."id"),
  d."id",
  m."id",
  true,
  COALESCE(d."decidedAt", d."requestedAt", d."createdAt"),
  'ترحيل نظام اللجان'
FROM "Member" m
JOIN "Department" d ON d."id" = m."departmentId"
JOIN "Invite" i ON i."id" = m."inviteId"
WHERE d."parentId" IS NOT NULL
  AND m."isActive" = true
  AND m."approvalStatus" = 'approved'
  AND i."targetRole" = 'member'
ON CONFLICT ("committeeId", "memberId") DO NOTHING;
