-- «طلب إنهاء فترة الإدارة في تَـــلاقِ».
--
-- يرفعه صاحبه لا تُقرَّر عنه. والرفع لا يُعطّل أحداً: من طلب الإنهاء
-- يبقى على عمله حتى يُقرّر مسؤولُه وتحلّ مهلته. ولو عُطِّل بالرفع لصار
-- الطلب عقوبةً يخشاها من يحقّ له طلبُه، ولأمكن أن يُخرِج نفسَه بضغطةٍ
-- بلا مراجعة.
--
-- ولقاءُ المسؤول ليس قراراً: قد يُقنعه بالبقاء أو يتفهّم فيوافق — وفي
-- الحالتين القرار يأتي بعده لا معه. ولهذا `meeting_requested` حالةٌ
-- قائمةٌ بذاتها لا موافقةٌ ولا رفض.
CREATE TYPE "TerminationStatus" AS ENUM (
  'submitted', 'meeting_requested', 'approved', 'rejected', 'effective', 'withdrawn'
);

CREATE TABLE "TerminationRequest" (
  "id"                 TEXT NOT NULL,
  "memberId"           TEXT NOT NULL,
  "assignmentLabel"    TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "status"             "TerminationStatus" NOT NULL DEFAULT 'submitted',
  "submittedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestedEndDate"   TIMESTAMP(3),
  "decidedAt"          TIMESTAMP(3),
  "decidedById"        TEXT,
  "decidedByName"      TEXT,
  "decisionNote"       TEXT,
  "meetingRequestedAt" TIMESTAMP(3),
  "meetingNote"        TEXT,
  "effectiveAt"        TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TerminationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TerminationRequest_memberId_status_idx" ON "TerminationRequest"("memberId", "status");
CREATE INDEX "TerminationRequest_status_submittedAt_idx" ON "TerminationRequest"("status", "submittedAt");

-- حذفُ العضو يُزيل طلباته معه؛ وحذفُ من قرّر يُفرِغ معرّفه ويُبقي اسمه
-- في `decidedByName` — فلا يُفقَد من قرّر.
ALTER TABLE "TerminationRequest" ADD CONSTRAINT "TerminationRequest_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TerminationRequest" ADD CONSTRAINT "TerminationRequest_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
