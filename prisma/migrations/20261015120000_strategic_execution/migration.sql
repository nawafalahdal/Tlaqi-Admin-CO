-- نظامُ التنفيذ الاستراتيجي: أهدافٌ ومحطاتٌ وخططُ أسابيع ومهامٌّ تَعبرها
-- (مولَّدٌ من فرق المخطّط، ومراجَعٌ سطراً سطراً قبل التطبيق)
-- CreateEnum
CREATE TYPE "WorkPriority" AS ENUM ('critical', 'high', 'normal', 'low');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('draft', 'proposed', 'approved', 'rejected', 'active', 'achieved', 'missed', 'cancelled');

-- CreateEnum
CREATE TYPE "ObjectiveStatus" AS ENUM ('proposed', 'approved', 'rejected', 'active', 'at_risk', 'done', 'missed', 'cancelled');

-- CreateEnum
CREATE TYPE "PeriodState" AS ENUM ('draft', 'submitted', 'approved_for_review', 'awaiting_review', 'awaiting_opening', 'open', 'closed', 'reopened');

-- CreateEnum
CREATE TYPE "WeekPlanState" AS ENUM ('draft', 'submitted', 'approved', 'returned');

-- CreateEnum
CREATE TYPE "TaskExecState" AS ENUM ('not_started', 'in_progress', 'submitted', 'verified', 'returned', 'incomplete', 'blocked', 'waived', 'cancelled', 'superseded', 'deferred');

-- CreateEnum
CREATE TYPE "ReviewDecisionKind" AS ENUM ('verified', 'returned', 'incomplete', 'flagged');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('deadline_change', 'reassign', 'scope_change', 'defer', 'waive', 'cancel', 'supersede', 'lock_exception', 'dependency_resolution', 'reopen_period', 'emergency_open', 'priority_change', 'weight_change');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'held', 'cancelled', 'rescheduled');

-- CreateTable
CREATE TABLE "StrategicGoal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "impact" TEXT,
    "accountableUserId" TEXT,
    "ownerUserId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "successCriteria" TEXT NOT NULL,
    "baselineValue" TEXT,
    "targetValue" TEXT,
    "priority" "WorkPriority" NOT NULL DEFAULT 'normal',
    "status" "GoalStatus" NOT NULL DEFAULT 'draft',
    "proposedById" TEXT,
    "proposedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "decisionNote" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'approved',
    "correctivePlan" TEXT,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentObjective" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "WorkPriority" NOT NULL DEFAULT 'normal',
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'proposed',
    "leadUserId" TEXT,
    "proposedByName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPeriod" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "state" "PeriodState" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "openedById" TEXT,
    "openedByName" TEXT,
    "emergencyOpen" BOOLEAN NOT NULL DEFAULT false,
    "emergencyReason" TEXT,
    "unresolvedAtOpen" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedByName" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,

    CONSTRAINT "ExecutionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeekPlan" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "state" "WeekPlanState" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "decisionNote" TEXT,
    "capacityPoints" INTEGER,
    "overloadAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "overloadNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeekPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "periodId" TEXT,
    "departmentId" TEXT,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "objectiveId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT NOT NULL,
    "deliverable" TEXT,
    "ownerUserId" TEXT,
    "ownerMemberId" TEXT,
    "priority" "WorkPriority" NOT NULL DEFAULT 'normal',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "originalDueAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "execState" "TaskExecState" NOT NULL DEFAULT 'not_started',
    "reportedDoneAt" TIMESTAMP(3),
    "reportedByName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedByName" TEXT,
    "blockedReason" TEXT,
    "carryoverCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveCarryover" INTEGER NOT NULL DEFAULT 0,
    "carriedFromPeriodId" TEXT,
    "carryReason" TEXT,
    "correctivePlan" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "supersededById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCarryover" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromPeriodId" TEXT NOT NULL,
    "toPeriodId" TEXT NOT NULL,
    "stateAtCarry" "TaskExecState" NOT NULL,
    "reason" TEXT,
    "correctivePlan" TEXT,
    "decidedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCarryover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSubmission" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "evidenceFileName" TEXT,
    "evidenceMime" TEXT,
    "evidenceSize" INTEGER,
    "evidenceData" BYTEA,
    "submittedById" TEXT,
    "submittedByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskReview" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "submissionId" TEXT,
    "periodId" TEXT,
    "decision" "ReviewDecisionKind" NOT NULL,
    "note" TEXT,
    "reviewerId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkChange" (
    "id" TEXT NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "taskId" TEXT,
    "goalId" TEXT,
    "periodId" TEXT,
    "reason" TEXT NOT NULL,
    "previousJson" JSONB,
    "nextJson" JSONB,
    "effectiveAt" TIMESTAMP(3),
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingConfig" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "weekday" INTEGER NOT NULL DEFAULT 6,
    "hour" INTEGER NOT NULL DEFAULT 21,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "organizerId" TEXT,
    "organizerName" TEXT,
    "locationOrUrl" TEXT,
    "agendaTemplate" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMeeting" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "organizerName" TEXT,
    "locationOrUrl" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "heldAt" TIMESTAMP(3),
    "rescheduledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "stagesDoneJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDecision" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategicGoal_status_dueDate_idx" ON "StrategicGoal"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Milestone_goalId_dueDate_idx" ON "Milestone"("goalId", "dueDate");

-- CreateIndex
CREATE INDEX "DepartmentObjective_departmentId_status_idx" ON "DepartmentObjective"("departmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPeriod_weekStart_key" ON "ExecutionPeriod"("weekStart");

-- CreateIndex
CREATE INDEX "ExecutionPeriod_state_idx" ON "ExecutionPeriod"("state");

-- CreateIndex
CREATE INDEX "WeekPlan_departmentId_state_idx" ON "WeekPlan"("departmentId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WeekPlan_periodId_departmentId_key" ON "WeekPlan"("periodId", "departmentId");

-- CreateIndex
CREATE INDEX "PlanTask_periodId_execState_idx" ON "PlanTask"("periodId", "execState");

-- CreateIndex
CREATE INDEX "PlanTask_departmentId_execState_idx" ON "PlanTask"("departmentId", "execState");

-- CreateIndex
CREATE INDEX "PlanTask_ownerUserId_execState_idx" ON "PlanTask"("ownerUserId", "execState");

-- CreateIndex
CREATE INDEX "PlanTask_ownerMemberId_execState_idx" ON "PlanTask"("ownerMemberId", "execState");

-- CreateIndex
CREATE INDEX "PlanTask_dueAt_idx" ON "PlanTask"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "TaskCarryover_toPeriodId_idx" ON "TaskCarryover"("toPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCarryover_taskId_toPeriodId_key" ON "TaskCarryover"("taskId", "toPeriodId");

-- CreateIndex
CREATE INDEX "TaskSubmission_taskId_submittedAt_idx" ON "TaskSubmission"("taskId", "submittedAt");

-- CreateIndex
CREATE INDEX "TaskReview_taskId_decidedAt_idx" ON "TaskReview"("taskId", "decidedAt");

-- CreateIndex
CREATE INDEX "WorkChange_taskId_createdAt_idx" ON "WorkChange"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkChange_kind_createdAt_idx" ON "WorkChange"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMeeting_periodId_key" ON "ReviewMeeting"("periodId");

-- CreateIndex
CREATE INDEX "ReviewMeeting_scheduledAt_idx" ON "ReviewMeeting"("scheduledAt");

-- CreateIndex
CREATE INDEX "MeetingDecision_meetingId_createdAt_idx" ON "MeetingDecision"("meetingId", "createdAt");

-- AddForeignKey
ALTER TABLE "StrategicGoal" ADD CONSTRAINT "StrategicGoal_accountableUserId_fkey" FOREIGN KEY ("accountableUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategicGoal" ADD CONSTRAINT "StrategicGoal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "StrategicGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentObjective" ADD CONSTRAINT "DepartmentObjective_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentObjective" ADD CONSTRAINT "DepartmentObjective_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "StrategicGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentObjective" ADD CONSTRAINT "DepartmentObjective_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentObjective" ADD CONSTRAINT "DepartmentObjective_leadUserId_fkey" FOREIGN KEY ("leadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekPlan" ADD CONSTRAINT "WeekPlan_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExecutionPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeekPlan" ADD CONSTRAINT "WeekPlan_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeekPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExecutionPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "StrategicGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "DepartmentObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCarryover" ADD CONSTRAINT "TaskCarryover_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCarryover" ADD CONSTRAINT "TaskCarryover_fromPeriodId_fkey" FOREIGN KEY ("fromPeriodId") REFERENCES "ExecutionPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCarryover" ADD CONSTRAINT "TaskCarryover_toPeriodId_fkey" FOREIGN KEY ("toPeriodId") REFERENCES "ExecutionPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSubmission" ADD CONSTRAINT "TaskSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TaskSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReview" ADD CONSTRAINT "TaskReview_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExecutionPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChange" ADD CONSTRAINT "WorkChange_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChange" ADD CONSTRAINT "WorkChange_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "StrategicGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMeeting" ADD CONSTRAINT "ReviewMeeting_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExecutionPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ReviewMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

