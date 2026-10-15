-- مركزُ التحسين: التذكرةُ حين تكون اقتراحاً.
--
-- ولا جدولَ ثانياً: التحسينُ تذكرةٌ لها نوعٌ وحالة، فتَرث الطابورَ
-- والرؤيةَ والإكسل والاعتمادَ بلا نسخةٍ ثانيةٍ من كلٍّ منها.
-- ولا حذفَ هنا ولا تغييرَ عمودٍ قائم — إضافةٌ محضة.

CREATE TYPE "ImprovementKind" AS ENUM ('bug', 'confusing', 'idea');

CREATE TYPE "ImprovementState" AS ENUM (
  'new', 'triaged', 'in_progress', 'awaiting_user', 'resolved', 'closed'
);

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "improvementKind"  "ImprovementKind";
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "improvementState" "ImprovementState";
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "pageContext"      TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "userVerifiedAt"   TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "userRejectedAt"   TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "convertedTaskId"  TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "convertedGoalId"  TEXT;

-- وصندوقُ التحسينات يسأل عن النوع والحالة، فيُجاب بفهرسٍ لا بمسحٍ كامل
CREATE INDEX IF NOT EXISTS "Ticket_improvementKind_improvementState_idx"
  ON "Ticket" ("improvementKind", "improvementState");
