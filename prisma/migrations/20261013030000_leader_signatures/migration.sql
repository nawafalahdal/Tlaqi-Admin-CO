-- توقيعات القادة.
--
-- ولا يُعاد استعمال توقيع قائدٍ سابق لخَلَفِه أبداً: التوقيع مرتبط بصاحبه
-- ودوره وقسمه لا بالمنصب وحده. فمن خرج بطل توقيعه (`superseded`) ولم
-- يُورَّث، ومن جاء طُلب منه توقيعُه هو. وتوريثُه انتحالٌ — شهادةٌ تحمل
-- توقيع من لم يكن في المنصة يوم صدورها.
CREATE TYPE "SignatureStatus" AS ENUM ('requested', 'submitted', 'approved', 'rejected', 'superseded');

CREATE TABLE "LeaderSignature" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "role"          TEXT NOT NULL,
  "departmentId"  TEXT,
  "status"        "SignatureStatus" NOT NULL DEFAULT 'requested',
  "imageData"     TEXT,
  "requestedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt"   TIMESTAMP(3),
  "approvedAt"    TIMESTAMP(3),
  "approvedById"  TEXT,
  "rejectedAt"    TIMESTAMP(3),
  "rejectionNote" TEXT,
  "supersededAt"  TIMESTAMP(3),
  "remindedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaderSignature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeaderSignature_userId_status_idx" ON "LeaderSignature"("userId", "status");
CREATE INDEX "LeaderSignature_role_departmentId_status_idx" ON "LeaderSignature"("role", "departmentId", "status");

-- حذفُ الحساب يُزيل توقيعه معه (لا معنى لتوقيعٍ بلا صاحب)، وحذفُ
-- المُعتمِد يُفرِغ معرّفه ولا يُبطل التوقيع المعتمَد.
ALTER TABLE "LeaderSignature" ADD CONSTRAINT "LeaderSignature_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaderSignature" ADD CONSTRAINT "LeaderSignature_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeaderSignature" ADD CONSTRAINT "LeaderSignature_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
