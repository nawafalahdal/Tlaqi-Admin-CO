-- CreateEnum
CREATE TYPE "SeniorCapability" AS ENUM ('board_view', 'committees_view', 'governance_log_view', 'agreements_view', 'agreements_manage');

-- CreateEnum
CREATE TYPE "SeniorInviteState" AS ENUM ('draft', 'sent', 'opened', 'accepted', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "SeniorPositionStatus" AS ENUM ('pending', 'active', 'suspended', 'ended');

-- CreateEnum
CREATE TYPE "AgreementKind" AS ENUM ('marketing', 'technical');

-- CreateEnum
CREATE TYPE "AgreementTemplateStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "AgreementIncidentStatus" AS ENUM ('reported', 'under_review', 'closed');

-- AlterEnum
ALTER TYPE "CommitteeStatus" ADD VALUE 'awaiting_lead';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "archivedFromStatus" "CommitteeStatus",
ADD COLUMN     "leadAssignedAt" TIMESTAMP(3),
ADD COLUMN     "leadAssignedByName" TEXT,
ADD COLUMN     "seniorLeaderBasis" TEXT,
ADD COLUMN     "seniorLeaderSince" TIMESTAMP(3),
ADD COLUMN     "seniorLeaderUserId" TEXT;

-- AlterTable
ALTER TABLE "OrgAuditEvent" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "result" TEXT NOT NULL DEFAULT 'success';

-- CreateTable
CREATE TABLE "SeniorPosition" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT,
    "description" TEXT,
    "responsibilities" TEXT,
    "capabilities" "SeniorCapability"[] DEFAULT ARRAY[]::"SeniorCapability"[],
    "startDate" TIMESTAMP(3),
    "status" "SeniorPositionStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "holderMemberId" TEXT,
    "holderUserId" TEXT,
    "inviteName" TEXT NOT NULL,
    "inviteEmail" TEXT NOT NULL,
    "inviteState" "SeniorInviteState" NOT NULL DEFAULT 'draft',
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "invitedByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByName" TEXT,
    "cancelReason" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedByName" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeniorPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementTemplate" (
    "id" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT,
    "issuer" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" "AgreementTemplateStatus" NOT NULL DEFAULT 'draft',
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByName" TEXT,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "AgreementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementRequirement" (
    "id" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "subjectEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByName" TEXT,
    "cancelReason" TEXT,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "AgreementRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSignature" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "documentHash" TEXT NOT NULL,
    "signerKind" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "signerAccountName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "otpVerifiedAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "evidenceHash" TEXT NOT NULL,
    "prevEvidenceHash" TEXT,

    CONSTRAINT "AgreementSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementOtp" (
    "id" TEXT NOT NULL,
    "signerKind" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAccessGrant" (
    "id" TEXT NOT NULL,
    "category" "AgreementKind" NOT NULL,
    "assetKind" TEXT NOT NULL,
    "assetLabel" TEXT NOT NULL,
    "holderKind" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "signatureId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByName" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "AssetAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementIncident" (
    "id" TEXT NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "reportedByName" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AgreementIncidentStatus" NOT NULL DEFAULT 'reported',
    "reviewNote" TEXT,
    "reviewedByName" TEXT,
    "outcome" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AgreementIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceSyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "GovernanceSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeniorPosition_inviteTokenHash_key" ON "SeniorPosition"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "SeniorPosition_inviteEmail_idx" ON "SeniorPosition"("inviteEmail");

-- CreateIndex
CREATE INDEX "SeniorPosition_status_idx" ON "SeniorPosition"("status");

-- CreateIndex
CREATE INDEX "SeniorPosition_holderMemberId_idx" ON "SeniorPosition"("holderMemberId");

-- CreateIndex
CREATE INDEX "SeniorPosition_holderUserId_idx" ON "SeniorPosition"("holderUserId");

-- CreateIndex
CREATE INDEX "AgreementTemplate_kind_status_idx" ON "AgreementTemplate"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementTemplate_kind_version_key" ON "AgreementTemplate"("kind", "version");

-- CreateIndex
CREATE INDEX "AgreementRequirement_kind_idx" ON "AgreementRequirement"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementRequirement_kind_subjectKind_subjectId_key" ON "AgreementRequirement"("kind", "subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "AgreementSignature_signerKind_signerId_kind_idx" ON "AgreementSignature"("signerKind", "signerId", "kind");

-- CreateIndex
CREATE INDEX "AgreementSignature_kind_version_idx" ON "AgreementSignature"("kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSignature_templateId_signerKind_signerId_key" ON "AgreementSignature"("templateId", "signerKind", "signerId");

-- CreateIndex
CREATE INDEX "AgreementOtp_signerKind_signerId_templateId_idx" ON "AgreementOtp"("signerKind", "signerId", "templateId");

-- CreateIndex
CREATE INDEX "AssetAccessGrant_holderKind_holderId_idx" ON "AssetAccessGrant"("holderKind", "holderId");

-- CreateIndex
CREATE INDEX "AssetAccessGrant_category_revokedAt_idx" ON "AssetAccessGrant"("category", "revokedAt");

-- CreateIndex
CREATE INDEX "AgreementIncident_status_idx" ON "AgreementIncident"("status");

-- CreateIndex
CREATE INDEX "AgreementIncident_subjectKind_subjectId_idx" ON "AgreementIncident"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "GovernanceSyncRun_startedAt_idx" ON "GovernanceSyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_seniorLeaderUserId_fkey" FOREIGN KEY ("seniorLeaderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeniorPosition" ADD CONSTRAINT "SeniorPosition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeniorPosition" ADD CONSTRAINT "SeniorPosition_holderMemberId_fkey" FOREIGN KEY ("holderMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeniorPosition" ADD CONSTRAINT "SeniorPosition_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSignature" ADD CONSTRAINT "AgreementSignature_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AgreementTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════
--  حمايةٌ في القاعدة نفسها — لا تكفي الشيفرةُ وحدها
-- ═════════════════════════════════════════════════════════════════════

-- ── تكليفُ الإدارة العليا لصاحبٍ واحد: عضوٌ أو حسابٌ إداري، لا الاثنان
ALTER TABLE "SeniorPosition" ADD CONSTRAINT "SeniorPosition_single_holder"
  CHECK (NOT ("holderMemberId" IS NOT NULL AND "holderUserId" IS NOT NULL));

-- ── لا دعوتان قائمتان (ولا تكليفان حيّان) للبريد نفسه في وقتٍ واحد
CREATE OR REPLACE FUNCTION tlaqi_senior_position_unique_live() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('pending', 'active', 'suspended') AND NEW."inviteState" NOT IN ('expired', 'cancelled') THEN
    IF EXISTS (
      SELECT 1 FROM "SeniorPosition" p
      WHERE p."id" <> NEW."id"
        AND lower(p."inviteEmail") = lower(NEW."inviteEmail")
        AND p."status" IN ('pending', 'active', 'suspended')
        AND p."inviteState" NOT IN ('expired', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'SENIOR_POSITION_DUPLICATE: لهذا البريد دعوةٌ أو تكليفٌ قائمٌ في الإدارة العليا';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SeniorPosition_unique_live"
  BEFORE INSERT OR UPDATE ON "SeniorPosition"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_senior_position_unique_live();

-- ── رئيسٌ تنفيذيٌّ نشطٌ واحد — يُفحص حين يصير حسابٌ رئيساً تنفيذياً نشطاً، فلا يمرّ تعيينان متزامنان
CREATE OR REPLACE FUNCTION tlaqi_single_active_executive() RETURNS trigger AS $$
BEGIN
  IF NEW."role" = 'executive' AND NEW."isActive"
     AND (TG_OP = 'INSERT' OR OLD."role" <> 'executive' OR NOT OLD."isActive") THEN
    PERFORM pg_advisory_xact_lock(hashtext('tlaqi:seat:executive'));
    IF EXISTS (SELECT 1 FROM "User" u WHERE u."id" <> NEW."id" AND u."role" = 'executive' AND u."isActive") THEN
      RAISE EXCEPTION 'EXECUTIVE_SEAT_TAKEN: يوجد رئيسٌ تنفيذيٌّ نشط — لا يجتمع رئيسان تنفيذيان';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "User_single_active_executive"
  BEFORE INSERT OR UPDATE OF "role", "isActive" ON "User"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_single_active_executive();

-- ── سجلُّ التدقيق وتوقيعاتُ الاتفاقيات: إلحاقٌ فقط — لا تعديل ولا حذف ولا تفريغ
CREATE OR REPLACE FUNCTION tlaqi_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % سجلٌّ للإلحاق فقط — لا يُعدَّل ولا يُحذف', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OrgAuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "OrgAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_append_only();
CREATE TRIGGER "OrgAuditEvent_no_truncate"
  BEFORE TRUNCATE ON "OrgAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION tlaqi_append_only();
CREATE TRIGGER "AgreementSignature_append_only"
  BEFORE UPDATE OR DELETE ON "AgreementSignature"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_append_only();
CREATE TRIGGER "AgreementSignature_no_truncate"
  BEFORE TRUNCATE ON "AgreementSignature"
  FOR EACH STATEMENT EXECUTE FUNCTION tlaqi_append_only();

-- ── نصُّ الاتفاقية المنشور لا يتغيّر: النوعُ والإصدارُ والعنوانُ والنصُّ والبصمةُ ثابتةٌ بعد النشر،
--    ولا يُحذف إصدارٌ نُشر. والانتقالُ الوحيد بعده: سارٍ ← متقاعد
CREATE OR REPLACE FUNCTION tlaqi_agreement_template_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'AGREEMENT_FROZEN: إصدارٌ منشورٌ لا يُحذف';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'draft' AND (
       NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."titleAr" IS DISTINCT FROM OLD."titleAr" OR NEW."issuer" IS DISTINCT FROM OLD."issuer"
    OR NEW."body" IS DISTINCT FROM OLD."body" OR NEW."bodyHash" IS DISTINCT FROM OLD."bodyHash"
    OR (OLD."status" = 'retired' AND NEW."status" <> 'retired')
    OR (OLD."status" = 'active' AND NEW."status" NOT IN ('active', 'retired'))
  ) THEN
    RAISE EXCEPTION 'AGREEMENT_FROZEN: نصُّ الإصدار المنشور ثابت — أنشئ إصداراً جديداً';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AgreementTemplate_frozen"
  BEFORE UPDATE OR DELETE ON "AgreementTemplate"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_agreement_template_frozen();

-- ── إصدارٌ سارٍ واحد لكل نوع اتفاقية
CREATE OR REPLACE FUNCTION tlaqi_agreement_single_active() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'active' AND EXISTS (
    SELECT 1 FROM "AgreementTemplate" t WHERE t."id" <> NEW."id" AND t."kind" = NEW."kind" AND t."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'AGREEMENT_ACTIVE_EXISTS: لهذا النوع إصدارٌ سارٍ — يتقاعد السابقُ أولاً';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AgreementTemplate_single_active"
  BEFORE INSERT OR UPDATE ON "AgreementTemplate"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_agreement_single_active();
