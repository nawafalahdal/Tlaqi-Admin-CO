-- ترتيبُ الأرقام الوظيفية بالقيادة (قرار المؤسس، 17 نوفمبر 2026): المؤسس 001، الرئيس التنفيذي 002، المتابعة والتشغيل 003،
-- ثم بقيةُ الفريق 004 فما بعده **بترتيبهم الحالي نفسِه** (أي بتاريخ الانضمام الذي رُقّموا به أول مرة).
--
-- • **مرّةٌ واحدة، لا قاعدةٌ دائمة:** الرقمُ للشخص لا للمنصب — من يُعيَّن رئيساً تنفيذياً لاحقاً يحتفظ برقمه.
-- • **المقاعدُ بالحساب الإداري النشط:** `super_admin` ← 001، `executive` ← 002، `operations_officer` ← 003. ولو تعدّد صاحبُ
--   المقعد (حالةُ بياناتٍ يُبلغ عنها الهيكل) أخذه الأقدمُ رقماً، وبقي الآخرُ في موضعه بين الفريق. ومقعدٌ بلا صاحب لا يُحجز.
-- • **لا رقمَ يُخترع ولا رقمَ متقاعداً يُستعاد:** بقيةُ الفريق تأخذ الأرقامَ المستعملة نفسَها مرتّبة (بعد استبعاد 001–003)،
--   فرقمُ من حُذف نهائياً لا يُمنح لأحد. والسابقون (المنتهية عضويتهم) يُرتَّبون مع الجميع فلا يتكرّر رقمٌ في السجل.
-- • **التوأمان رقمٌ واحد:** الحسابُ الإداري وسجلُّ عضويته يحملان الرقمَ نفسَه، فالتحويلُ بالرقم القديم يُبقيهما متطابقَين.
-- • **مُدقَّق:** كلُّ رقمٍ تغيّر يُسجَّل في `OrgAuditEvent` بقيمتيه قبل وبعد — فالتغييرُ مرئيٌّ في سجل الإدارة العليا وقابلٌ للعكس.
-- • **ذرّي:** كتلةٌ واحدة؛ إما يُطبَّق كلُّه أو لا شيء. وعلى قاعدةٍ مرتّبةٍ أصلاً لا يغيّر شيئاً.
DO $$
DECLARE
  holders int;
  mapped int;
  top int;
BEGIN
  -- كلُّ رقمٍ مُسنَد، وأعلى مقعدٍ قياديٍّ لصاحبه (0 مؤسس، 1 تنفيذي، 2 تشغيل، 3 الفريق)
  CREATE TEMP TABLE "_eno_holder" AS
  SELECT h.old, MIN(h.pri) AS pri
  FROM (
    SELECT u."employeeNo" AS old,
           CASE WHEN u."isActive" AND u."role" = 'super_admin' THEN 0
                WHEN u."isActive" AND u."role" = 'executive' THEN 1
                WHEN u."isActive" AND u."role" = 'operations_officer' THEN 2
                ELSE 3 END AS pri
    FROM "User" u
    WHERE u."employeeNo" IS NOT NULL
    UNION ALL
    SELECT m."employeeNo", 3 FROM "Member" m WHERE m."employeeNo" IS NOT NULL
  ) h
  GROUP BY h.old;

  CREATE TEMP TABLE "_eno_map" ("old" int PRIMARY KEY, "new" int NOT NULL UNIQUE);

  -- المقاعدُ الثلاثة: صاحبٌ واحدٌ لكل مقعد (الأقدمُ رقماً)
  INSERT INTO "_eno_map" ("old", "new")
  SELECT DISTINCT ON (pri) old, pri + 1 FROM "_eno_holder" WHERE pri < 3 ORDER BY pri, old;

  -- البقيةُ بترتيبهم الحالي على الأرقام المستعملة الباقية تصاعدياً
  INSERT INTO "_eno_map" ("old", "new")
  SELECT r.old, p.n
  FROM (
    SELECT old, row_number() OVER (ORDER BY old) AS rn
    FROM "_eno_holder"
    WHERE old NOT IN (SELECT "old" FROM "_eno_map")
  ) r
  JOIN (
    SELECT n, row_number() OVER (ORDER BY n) AS rn
    FROM (SELECT old AS n FROM "_eno_holder" UNION SELECT "new" FROM "_eno_map") pool
    WHERE n NOT IN (SELECT "new" FROM "_eno_map")
  ) p ON p.rn = r.rn;

  SELECT COUNT(*) INTO holders FROM "_eno_holder";
  SELECT COUNT(*) INTO mapped FROM "_eno_map";
  IF holders <> mapped THEN
    RAISE EXCEPTION 'ترتيب الأرقام: % رقماً مُسنَداً و% في الخريطة — لا يُطبَّق شيء', holders, mapped;
  END IF;

  DELETE FROM "_eno_map" WHERE "old" = "new";

  -- السجلُّ قبل التغيير (القيمتان)
  INSERT INTO "OrgAuditEvent" ("id", "scope", "entityId", "departmentId", "action", "actorKind", "actorId", "actorName", "actorRole", "result", "before", "after", "note", "createdAt")
  SELECT gen_random_uuid()::text, 'account', u."id", COALESCE(u."departmentId", ''), 'employee_no.reordered', 'system',
         'migration:20261117060000', 'ترتيب الأرقام الوظيفية (قرار المؤسس)', NULL, 'success',
         jsonb_build_object('employeeNo', m."old"), jsonb_build_object('employeeNo', m."new"),
         u."fullName" || ' — المؤسس 001، الرئيس التنفيذي 002، المتابعة والتشغيل 003، ثم الفريق بترتيبه', NOW()
  FROM "User" u JOIN "_eno_map" m ON m."old" = u."employeeNo";
  INSERT INTO "OrgAuditEvent" ("id", "scope", "entityId", "departmentId", "action", "actorKind", "actorId", "actorName", "actorRole", "result", "before", "after", "note", "createdAt")
  SELECT gen_random_uuid()::text, 'member', mb."id", COALESCE(mb."departmentId", ''), 'employee_no.reordered', 'system',
         'migration:20261117060000', 'ترتيب الأرقام الوظيفية (قرار المؤسس)', NULL, 'success',
         jsonb_build_object('employeeNo', m."old"), jsonb_build_object('employeeNo', m."new"),
         mb."fullName" || ' — المؤسس 001، الرئيس التنفيذي 002، المتابعة والتشغيل 003، ثم الفريق بترتيبه', NOW()
  FROM "Member" mb JOIN "_eno_map" m ON m."old" = mb."employeeNo";

  -- على مرحلتين فلا يصطدم رقمٌ جديد برقمٍ قديمٍ لم يُنقل بعد (الفهرسان الفريدان يُفحصان صفّاً صفّاً)
  UPDATE "User" u SET "employeeNo" = -m."new" FROM "_eno_map" m WHERE u."employeeNo" = m."old";
  UPDATE "Member" mb SET "employeeNo" = -m."new" FROM "_eno_map" m WHERE mb."employeeNo" = m."old";
  UPDATE "User" SET "employeeNo" = -"employeeNo" WHERE "employeeNo" < 0;
  UPDATE "Member" SET "employeeNo" = -"employeeNo" WHERE "employeeNo" < 0;

  -- التسلسلُ لا يرجع أبداً: يكمل بعد أعلى رقمٍ عرفه (فرقمُ المحذوف في آخر السلسلة لا يُعاد)
  SELECT GREATEST(
           COALESCE((SELECT MAX("employeeNo") FROM "User"), 0),
           COALESCE((SELECT MAX("employeeNo") FROM "Member"), 0)
         ) INTO top;
  IF top > 0 THEN
    PERFORM setval('"User_employeeNo_seq"', GREATEST(top, (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM "User_employeeNo_seq")), true);
  END IF;

  DROP TABLE "_eno_map";
  DROP TABLE "_eno_holder";
END $$;
