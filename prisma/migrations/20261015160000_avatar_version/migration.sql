-- ختمُ الصورة: يَصلح رابطاً أبدياً في المتصفّح، ويقول «أله صورة؟» بلا جلبِ الصورة.
--
-- وما مضى من صورٍ يُختَم بوقت الترحيل: هي موجودةٌ فعلاً، فلو بقي ختمُها
-- فارغاً لقُرئت كأن لا صورةَ لها — وهذا عطبٌ يُحدثه الترحيل لا يُصلحه.
-- ولا حذفَ هنا ولا تغييرَ عمودٍ قائم.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarVersion" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "avatarVersion" TIMESTAMP(3);

UPDATE "User"   SET "avatarVersion" = NOW() WHERE "avatarData" IS NOT NULL AND "avatarVersion" IS NULL;
UPDATE "Member" SET "avatarVersion" = NOW() WHERE "avatarData" IS NOT NULL AND "avatarVersion" IS NULL;
