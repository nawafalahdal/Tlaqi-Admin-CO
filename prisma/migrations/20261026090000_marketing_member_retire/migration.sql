-- عضويةُ فريق التسويق تبقى سجلاً بعد حذف حساب صاحبها.
--
-- **العطب:** حذفُ الحساب يُفرغ `userId`/`memberId` (`ON DELETE SET NULL`)، والقيدُ
-- السابق يشترط صاحباً واحداً بالضبط — فيفشل حذفُ أي حسابٍ انضمّ إلى الفريق
-- (حذفُ المؤسس النهائي، وحذفُ المرشّح). والقيدُ الآن: صاحبٌ واحدٌ على الأكثر.
-- ولا يمسّ هذا الترحيلُ إلا جدولَ `MarketingMember` الجديد.

ALTER TABLE "MarketingMember" DROP CONSTRAINT "MarketingMember_one_principal";
ALTER TABLE "MarketingMember" ADD CONSTRAINT "MarketingMember_one_principal"
  CHECK (num_nonnulls("userId", "memberId") <= 1);

-- اسمُ صاحبها لحظةَ إضافته — يُقرأ في السجلّ بعد حذف حسابه
ALTER TABLE "MarketingMember" ADD COLUMN "nameSnapshot" TEXT;

UPDATE "MarketingMember" AS mm SET "nameSnapshot" = u."fullName"
  FROM "User" AS u WHERE mm."userId" = u."id" AND mm."nameSnapshot" IS NULL;
UPDATE "MarketingMember" AS mm SET "nameSnapshot" = m."fullName"
  FROM "Member" AS m WHERE mm."memberId" = m."id" AND mm."nameSnapshot" IS NULL;
