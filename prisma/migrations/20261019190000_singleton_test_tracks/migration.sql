-- بنوكُ الأسئلة للمناصب الفردية: صفٌّ واحد لكلٍّ منها، بلا قسم.
--
-- ترحيلُ دور «مسؤول المتابعة والتشغيل» أضاف القيمة إلى التعداد ولم يُنشئ
-- صفَّ بنكه — والصفُّ كان يُنشئه البذرُ وحده، والبذرُ لا يجري في الإنتاج.
-- فكانت دعوةُ الرئيس التنفيذي له تسقط بـ«حدث خطأ غير متوقع».
--
-- إدراجٌ فقط، ولا يُدرج إلا ما غاب: آمنٌ على قاعدةٍ فيها الصفوف أصلاً.
-- ولا أسئلةَ تُبذر: البنكُ مِلكُ صاحبه، والدعوةُ تُرفض صراحةً ما دام فارغاً.
INSERT INTO "TestTrack" ("id", "scope", "departmentId", "createdAt")
SELECT gen_random_uuid()::text, s.scope::"TestTrackScope", NULL, NOW()
FROM (VALUES ('operations_officer'), ('department_admin'), ('executive')) AS s(scope)
WHERE NOT EXISTS (
  SELECT 1 FROM "TestTrack" t WHERE t.scope = s.scope::"TestTrackScope" AND t."departmentId" IS NULL
);
