-- شهادة تقدير الثلاثة أشهر: حدثٌ مستقلٌّ عن شهادة الإنهاء، له ختماه.
--
-- `appreciationDueAt` يوم الاستحقاق كما حُسب بالتقويم، لا يوم الإرسال:
-- فمن أُرسلت له متأخّرةً (تعطّل الكنس يوماً) يبقى في السجل أنه استحقّها
-- في موعدها، وتبقى الشهادة نفسها بتاريخها لا بتاريخ تعطّلنا.
ALTER TABLE "Member" ADD COLUMN "appreciationDueAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "appreciationIssuedAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "appreciationSentAt" TIMESTAMP(3);

-- الكنس يسأل كل يوم: من أكمل ثلاثةً ولم تصله شهادته؟ فالفهرس على
-- `appreciationSentAt` يجعل السؤال رخيصاً مهما كبر الجدول.
CREATE INDEX "Member_appreciationSentAt_idx" ON "Member"("appreciationSentAt");
