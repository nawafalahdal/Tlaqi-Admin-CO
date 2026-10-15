-- تقنينُ الكنس من الصفحات: صفٌّ لكل كنس يَحمل آخرَ موعدٍ جرى فيه.
--
-- والصفوفُ تُزرَع هنا بأعيانها ليكون الادّعاءُ تحديثاً واحداً مشروطاً
-- (`UPDATE ... WHERE lastRunAt < ?`) لا محاولةَ إنشاءٍ تَفشل في كل عرض.
-- وختمُها الأوّل في الماضي البعيد: أوّلُ عرضٍ بعد الترحيل يَكنس.
-- ولا حذفَ هنا ولا تغييرَ عمودٍ قائم.

CREATE TABLE IF NOT EXISTS "SweepRun" (
  "key"       TEXT NOT NULL,
  "lastRunAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SweepRun_pkey" PRIMARY KEY ("key")
);

INSERT INTO "SweepRun" ("key", "lastRunAt") VALUES
  ('overdue_requests',  TIMESTAMP '1970-01-01 00:00:00'),
  ('ticket_escalation', TIMESTAMP '1970-01-01 00:00:00'),
  ('candidate_expiry',  TIMESTAMP '1970-01-01 00:00:00')
ON CONFLICT ("key") DO NOTHING;
