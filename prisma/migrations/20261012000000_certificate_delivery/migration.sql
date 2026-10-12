-- إصدار الشهادة وتسليمها حدثان لا حدث.
--
-- كان `certificateIssuedAt` يحمل المعنيين: يُختم قبل الإرسال، فإن فشل
-- البريد بقيت الشهادة «مُسلَّمة» في السجل ولم تصل أبداً، ولا سبيل لإعادة
-- المحاولة — فالختم نفسه يمنعها.
--
-- فصار الإصدار وحده في `certificateIssuedAt` (مرّة واحدة لكل مسيرة، وهو
-- ما يجعل رابط الشهادة يعمل)، والتسليم في `certificateSentAt` (يُختم عند
-- نجاح البريد وحده، فتُعاد المحاولة ما لم يُختم).
ALTER TABLE "Member" ADD COLUMN "certificateSentAt" TIMESTAMP(3);

-- من سُلِّمت شهادته قبل هذا التمييز: نَعُدّها واصلةً، فلا تُرسَل إليه
-- رسالةٌ ثانية عن شهادةٍ قرأها.
UPDATE "Member" SET "certificateSentAt" = "certificateIssuedAt"
WHERE "certificateIssuedAt" IS NOT NULL;
