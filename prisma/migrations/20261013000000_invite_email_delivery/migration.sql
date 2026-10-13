-- وصول بريد الدعوة يُسجَّل.
--
-- لولا هذا لا يُعرف الفرق بين دعوةٍ وصلت ولم يفتحها صاحبها ودعوةٍ لم تصل
-- أصلاً — والأولى تُنتظَر والثانية تُعاد. والإعادة لا تُنشئ دعوةً ثانية:
-- إعادة تعيين بيانات المرشّح تُصدر رمزاً جديداً للدعوة نفسها.
ALTER TABLE "Invite" ADD COLUMN "emailSentAt" TIMESTAMP(3);
ALTER TABLE "Invite" ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0;

-- الدعوات القائمة قبل هذا التمييز: نَعُدّ بريدها واصلاً بتاريخ إنشائها،
-- فلا تُقرأ كأنها كلها فاشلة ولا تُعاد على أصحابها بلا سبب.
UPDATE "Invite" SET "emailSentAt" = "createdAt", "emailAttempts" = 1;
