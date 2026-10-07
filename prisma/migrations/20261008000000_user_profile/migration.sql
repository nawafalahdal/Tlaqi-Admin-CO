-- بيانات صاحب الحساب الإداري: نفس ما يسجّله العضو قبل اختباره
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "jobTitle" TEXT;
ALTER TABLE "User" ADD COLUMN "specialization" TEXT;
ALTER TABLE "User" ADD COLUMN "section" TEXT;
ALTER TABLE "User" ADD COLUMN "profileCompletedAt" TIMESTAMP(3);
