-- سلامة إغلاق التذاكر.
--
-- الإغلاق تصرّفٌ يُنسَب لصاحبه: `resolvedByUserId` يحفظ من أغلقها.
-- و`onDelete: SetNull` لا Restrict — حذفُ حسابٍ قديم لا يجوز أن يمنعه
-- أنه أغلق تذكرةً قبل سنة، ولا أن يمحو التذكرة معه.
ALTER TABLE "Ticket" ADD COLUMN "resolvedByUserId" TEXT;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- إعادة الفتح لا تقع ضمناً: كانت «قيد المعالجة» على تذكرةٍ مُغلقة
-- تُعيد فتحها وتمسح ختم إغلاقها بلا إذنٍ ولا أثر. فصارت تُسجَّل.
ALTER TABLE "Ticket" ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN "reopenedAt" TIMESTAMP(3);

-- الكنس يسأل: من تأخّر وما يزال مفتوحاً؟ فيُجاب بفهرسٍ لا بمسحٍ كامل
CREATE INDEX "Ticket_status_stageDueAt_idx" ON "Ticket"("status", "stageDueAt");
