-- صورة شخصية لكل شخص، وطلبُ اعتمادٍ إداري على التذكرة.
--
-- كلُّ ما يُضاف اختياريٌّ أو له قيمةٌ افتراضية، فلا صفٌّ قائم يحتاج تعبئةً
-- ولا يفشل الترحيل على بياناتٍ موجودة.

CREATE TYPE "ApprovalState" AS ENUM (
  'draft', 'awaiting', 'reviewing', 'returned',
  'approved', 'rejected', 'executing', 'completed'
);

CREATE TYPE "ApprovalKind" AS ENUM (
  'marketing_plan', 'financial_plan', 'initiative',
  'resources', 'operational', 'other'
);

-- الصور
ALTER TABLE "Member" ADD COLUMN "avatarData" TEXT;
ALTER TABLE "User"   ADD COLUMN "avatarData" TEXT;

-- الاعتماد على التذكرة
ALTER TABLE "Ticket" ADD COLUMN "approvalState"    "ApprovalState";
ALTER TABLE "Ticket" ADD COLUMN "approvalKind"     "ApprovalKind";
ALTER TABLE "Ticket" ADD COLUMN "approverUserId"   TEXT;
ALTER TABLE "Ticket" ADD COLUMN "approvalChain"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Ticket" ADD COLUMN "approvalStep"     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Ticket" ADD COLUMN "approvedAt"       TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "returnCount"      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_approverUserId_fkey"
  FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- سجلّ القرارات: صفٌّ لكل قرار، فيبقى التاريخ كاملاً
CREATE TABLE "ApprovalDecision" (
  "id"          TEXT NOT NULL,
  "ticketId"    TEXT NOT NULL,
  "deciderId"   TEXT,
  "deciderName" TEXT NOT NULL,
  "decision"    "ApprovalState" NOT NULL,
  "note"        TEXT,
  "step"        INTEGER NOT NULL DEFAULT 1,
  "decidedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalDecision_ticketId_decidedAt_idx"
  ON "ApprovalDecision"("ticketId", "decidedAt");

ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_deciderId_fkey"
  FOREIGN KEY ("deciderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
