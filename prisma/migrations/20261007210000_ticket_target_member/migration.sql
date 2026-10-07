-- التذكرة تُوجَّه أيضاً لعضو بعينه: كاتب المحتوى ← المصمّم ← مسؤول النشر
ALTER TABLE "Ticket" ADD COLUMN "targetMemberId" TEXT;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_targetMemberId_fkey"
  FOREIGN KEY ("targetMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
