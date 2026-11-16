-- جهةُ الاعتماد المستقلة (قرار المؤسس، نوفمبر 2026): المؤسسُ والرئيسُ التنفيذيُّ يطّلعان على النتائج ولا يحسمان.
-- إضافاتٌ فقط — لا يتغيّر شيءٌ في بيانات قائمة.

-- صلاحيةٌ تُمنح صراحةً في تكليف الإدارة العليا (ولا تسري لمؤسسٍ ولا لرئيسٍ تنفيذي — يُفرض في الشيفرة)
ALTER TYPE "SeniorCapability" ADD VALUE 'membership_decide';

-- من حسم القرار — مع تاريخه القائم (`decidedAt`) — لسجلّ القرارات
ALTER TABLE "Member" ADD COLUMN "decidedById" TEXT;
ALTER TABLE "Member" ADD COLUMN "decidedByName" TEXT;
