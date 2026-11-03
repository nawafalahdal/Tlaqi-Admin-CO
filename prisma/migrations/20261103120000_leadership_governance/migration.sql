-- حوكمةُ القيادة (المرحلة الثالثة) — إضافيّ: أعمدةٌ قابلةٌ للفراغ، وجدولٌ جديد، وقيدان.
-- لا يُحذف صفّ، ولا يُغيَّر عمودٌ قائم. والملءُ الوحيد: قائدٌ بالخلافة للجانٍ عاملةٍ بلا قائدٍ اليوم
-- (لا تبقى لجنةٌ نشطةٌ بلا قيادة)، وهو عمودٌ جديد لا يمسّ غيره.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "actingLeadReason" TEXT,
ADD COLUMN     "actingLeadSince" TIMESTAMP(3),
ADD COLUMN     "actingLeadUserId" TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "AccessRevocation" (
    "id" TEXT NOT NULL,
    "accountKind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessRevocation_revokedAt_idx" ON "AccessRevocation"("revokedAt");

-- CreateIndex
CREATE INDEX "AccessRevocation_accountId_idx" ON "AccessRevocation"("accountId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_actingLeadUserId_fkey" FOREIGN KEY ("actingLeadUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── الخلافة لما هو بلا قائدٍ اليوم: لجنةٌ نشطةٌ أو معلّقة ولا قائدَ لها (لجانُ النظام الأول قبل تحويلها، أو ما خلا).
--    الخَلَف: أقدمُ رئيسٍ تنفيذيٍّ نشط، ثم أقدمُ مؤسس — آليةُ الخلافة نفسُها في `succession.ts`.
--    فإن لم يوجد أيٌّ منهما فشل القيدُ أدناه، فيفشل الترحيلُ كلُّه ولا يقع شيء.
UPDATE "Department" AS d
SET "actingLeadUserId" = s."id",
    "actingLeadSince" = CURRENT_TIMESTAMP,
    "actingLeadReason" = 'خلافة عند الترحيل: لجنةٌ عاملة بلا قائد'
FROM (
  SELECT "id" FROM "User"
  WHERE "isActive" = true AND "role" IN ('executive', 'super_admin')
  ORDER BY CASE "role" WHEN 'executive' THEN 0 ELSE 1 END, "createdAt" ASC
  LIMIT 1
) AS s
WHERE d."parentId" IS NOT NULL
  AND d."committeeStatus" IN ('approved', 'suspended')
  AND d."leadMemberId" IS NULL
  AND d."actingLeadUserId" IS NULL;

-- ── قائدٌ فعّالٌ واحد لكل لجنة: لا يجتمع قائدٌ عضوٌ وقائدٌ بالخلافة
ALTER TABLE "Department" ADD CONSTRAINT "Department_single_committee_lead"
  CHECK (NOT ("leadMemberId" IS NOT NULL AND "actingLeadUserId" IS NOT NULL));

-- ── ولا لجنةٌ نشطةٌ أو معلّقة بلا قائد
ALTER TABLE "Department" ADD CONSTRAINT "Department_active_committee_has_lead"
  CHECK (
    "parentId" IS NULL
    OR "committeeStatus" IS NULL
    OR "committeeStatus" NOT IN ('approved', 'suspended')
    OR "leadMemberId" IS NOT NULL
    OR "actingLeadUserId" IS NOT NULL
  );
