-- الرقمُ الوظيفي (قرار المؤسس، نوفمبر 2026): تسلسلٌ واحدٌ للحسابات الإدارية والأعضاء، يبدأ بالمؤسس 001
-- ثم الموظفون القائمون بتاريخ انضمامهم الفعلي. لكل شخصٍ رقمٌ واحد: من له حسابٌ إداريٌّ نشط وسجلُّ عضويةٍ
-- (ترشّحه القديم أو عضويته قبل ترقيته) يأخذ رقمَ حسابه، ويُنسخ الرقمُ نفسُه إلى سجلّ عضويته.

-- اسمُه على عُرف Prisma ومملوكٌ للعمود (`@default(autoincrement())`): فلا يراه Prisma غريباً فيقترح حذفَه
CREATE SEQUENCE "User_employeeNo_seq" START WITH 1;

ALTER TABLE "User" ADD COLUMN "employeeNo" INTEGER;
ALTER TABLE "Member" ADD COLUMN "employeeNo" INTEGER;

-- مَن يُرقَّم: الحساباتُ الإدارية النشطة، والأعضاءُ المعتمدون النشطون بلا حسابٍ إداريٍّ نشطٍ بالبريد نفسه
CREATE TEMP TABLE "_employee_order" AS
WITH people AS (
  SELECT 'U'::text AS k, u."id",
         CASE WHEN u."role" = 'super_admin' THEN 0 ELSE 1 END AS pri,
         COALESCE(
           (SELECT m."joinDate" FROM "Member" m WHERE lower(m."email") = lower(u."email") LIMIT 1),
           u."createdAt"
         ) AS joined
  FROM "User" u
  WHERE u."isActive" = true
  UNION ALL
  SELECT 'M'::text, m."id", 1, COALESCE(m."joinDate", m."decidedAt", m."createdAt")
  FROM "Member" m
  WHERE m."isActive" = true
    AND m."approvalStatus" = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM "User" u WHERE lower(u."email") = lower(m."email") AND u."isActive" = true
    )
)
SELECT k, "id", row_number() OVER (ORDER BY pri, joined, "id")::int AS n FROM people;

UPDATE "User" u SET "employeeNo" = o.n FROM "_employee_order" o WHERE o.k = 'U' AND o."id" = u."id";
UPDATE "Member" m SET "employeeNo" = o.n FROM "_employee_order" o WHERE o.k = 'M' AND o."id" = m."id";

-- سجلُّ العضوية التوأم يحمل رقمَ صاحبه نفسَه
UPDATE "Member" m SET "employeeNo" = u."employeeNo"
FROM "User" u
WHERE lower(u."email") = lower(m."email") AND u."employeeNo" IS NOT NULL AND m."employeeNo" IS NULL;

CREATE UNIQUE INDEX "User_employeeNo_key" ON "User"("employeeNo");
CREATE UNIQUE INDEX "Member_employeeNo_key" ON "Member"("employeeNo");

-- يكمل التسلسلُ بعد آخر رقمٍ أُسنِد
SELECT setval(
  '"User_employeeNo_seq"',
  GREATEST((SELECT COALESCE(MAX(n), 0) FROM "_employee_order"), 1),
  (SELECT COUNT(*) FROM "_employee_order") > 0
);

ALTER SEQUENCE "User_employeeNo_seq" OWNED BY "User"."employeeNo";
ALTER TABLE "User" ALTER COLUMN "employeeNo" SET DEFAULT nextval('"User_employeeNo_seq"'::regclass);

DROP TABLE "_employee_order";
