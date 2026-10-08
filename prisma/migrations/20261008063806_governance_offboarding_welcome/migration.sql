-- حوكمة التنحي، والبريد الترحيبي، وقسم الإدارة العليا، وروابط الاجتماعات

-- الإعلان: رابط اجتماع ورابط مرفق
ALTER TABLE "Announcement" ADD COLUMN     "linkLabel" TEXT,
ADD COLUMN     "linkUrl" TEXT,
ADD COLUMN     "meetingUrl" TEXT;

-- القسم الاستثنائي: الإدارة العليا
ALTER TABLE "Department" ADD COLUMN     "leadershipOnly" BOOLEAN NOT NULL DEFAULT false;

-- العضو: البريد الترحيبي وحوكمة التنحي
ALTER TABLE "Member" ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "farewellDesignAt" TIMESTAMP(3),
ADD COLUMN     "noFurtherEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offboardingClosedAt" TIMESTAMP(3),
ADD COLUMN     "stepDownAt" TIMESTAMP(3),
ADD COLUMN     "stepDownByName" TEXT,
ADD COLUMN     "welcomeEmailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "welcomeEmailSentAt" TIMESTAMP(3);

-- التذكرة: رابط مرفق اختياري
ALTER TABLE "Ticket" ADD COLUMN     "linkUrl" TEXT;

-- الحساب الإداري: البريد الترحيبي وتذكير التحقق الثنائي
ALTER TABLE "User" ADD COLUMN     "totpNudgedAt" TIMESTAMP(3),
ADD COLUMN     "welcomeEmailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "welcomeEmailSentAt" TIMESTAMP(3);

-- الفهرس كان مُنشأً يدوياً وغائباً عن المخطط، فكاد يُسقَط. يُصرَّح به الآن.
CREATE INDEX IF NOT EXISTS "Announcement_createdAt_idx" ON "Announcement"("createdAt" DESC);

-- حذف مرشّح رفع تذكرةً كان يفشل بقيد RESTRICT: التذكرة سجلٌّ يبقى بعد
-- صاحبه، فتُفرَّغ إشارتها إليه بدل أن تمنع حذفه
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_memberId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_targetDepartmentId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
