-- اللجان: قسمٌ داخل قسم. لا جدولَ ثانٍ — أبٌ وحالةُ اعتماد على Department نفسه.
CREATE TYPE "CommitteeStatus" AS ENUM ('pending_review', 'approved', 'rejected');

ALTER TABLE "Department"
  ADD COLUMN "parentId"        TEXT,
  ADD COLUMN "committeeStatus" "CommitteeStatus",
  ADD COLUMN "leadTitle"       TEXT,
  ADD COLUMN "requestedById"   TEXT,
  ADD COLUMN "requestedByName" TEXT,
  ADD COLUMN "requestedAt"     TIMESTAMP(3),
  ADD COLUMN "decidedAt"       TIMESTAMP(3),
  ADD COLUMN "decidedByName"   TEXT,
  ADD COLUMN "decisionNote"    TEXT;

-- الحذف مقيَّد: قسمٌ يحمل لجنةً لا يُحذف حتى تُفرَّغ لجنتُه
ALTER TABLE "Department"
  ADD CONSTRAINT "Department_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- «لجانُ هذا القسم» سؤالٌ يُسأل في كل قراءةٍ للوحة القسم وللهيكل
CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");
