-- سحب التذكرة بطلب صاحبها: إغلاقٌ ليس إجابة، فيُسجَّل بعموده لا بحالة الحل
ALTER TABLE "Ticket" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
