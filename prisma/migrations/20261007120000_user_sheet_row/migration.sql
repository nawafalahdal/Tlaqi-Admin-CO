-- صف ثابت لكل حساب إداري في تبويب "الحسابات الإدارية" + تاريخ آخر تغيير لكلمة المرور
ALTER TABLE "User" ADD COLUMN "sheetRow" INTEGER;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
