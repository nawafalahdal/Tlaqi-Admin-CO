-- أنواع طلبات أكثر + مساري رفع صريحين
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'content_writing';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'design_work';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'publishing';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'tech_support';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'hr_support';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'equipment';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'budget_approval';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'escalate_to_executive';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'escalate_to_founder';
ALTER TYPE "RequestType" ADD VALUE IF NOT EXISTS 'other';

-- مرحلة أخيرة للتذكرة عند الإدارة العليا
ALTER TYPE "TicketStage" ADD VALUE IF NOT EXISTS 'founder_escalation';

-- بيانات المرشّح قبل الاختبار + إعادة فتح الاختبار
ALTER TABLE "Member" ADD COLUMN "specialization" TEXT;
ALTER TABLE "Member" ADD COLUMN "section" TEXT;
ALTER TABLE "Member" ADD COLUMN "profileCompletedAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "testReopenCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Member" ADD COLUMN "testReopenedAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "testReopenNote" TEXT;

-- التذكرة: يرفعها عضو أو حساب إداري، وتُوجَّه لقسم أو لشخص
ALTER TABLE "Ticket" ALTER COLUMN "memberId" DROP NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "targetDepartmentId" DROP NOT NULL;
ALTER TABLE "Ticket" ADD COLUMN "raisedByUserId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "targetUserId" TEXT;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_raisedByUserId_fkey"
  FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- الإعلان: هل نُسخ إلى البريد
ALTER TABLE "Announcement" ADD COLUMN "sentByEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Announcement" ADD COLUMN "emailRecipients" INTEGER NOT NULL DEFAULT 0;
