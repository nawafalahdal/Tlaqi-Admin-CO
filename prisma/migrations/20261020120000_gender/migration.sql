-- جنسُ صاحب الحساب للمخاطبة الصحيحة في الرسائل والشهادات.
--
-- إضافةٌ خالصة: نوعٌ جديد وعمودان يقبلان الفراغ. لا حذفَ ولا تغييرَ
-- عمودٍ قائم، ولا تعبئةَ تخمينية — من لم يختر يبقى فارغاً ويُخاطَب
-- بصيغةٍ محايدة.

DO $$ BEGIN
  CREATE TYPE "Gender" AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gender" "Gender";
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "gender" "Gender";
