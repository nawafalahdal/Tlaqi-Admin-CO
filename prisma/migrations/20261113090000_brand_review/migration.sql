-- CreateEnum
CREATE TYPE "BrandItemStatus" AS ENUM ('draft', 'ready_for_review', 'pending_approval', 'changes_requested', 'approved', 'published');

-- CreateEnum
CREATE TYPE "BrandVersionStatus" AS ENUM ('draft', 'active', 'retired');

-- AlterEnum
ALTER TYPE "SeniorCapability" ADD VALUE 'brand_prepare';

-- CreateTable
CREATE TABLE "BrandVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "status" "BrandVersionStatus" NOT NULL DEFAULT 'draft',
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "activatedByName" TEXT,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "BrandVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "BrandItemStatus" NOT NULL DEFAULT 'draft',
    "contentHash" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedRevision" INTEGER,
    "approvedHash" TEXT,
    "publishedByName" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "BrandItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandReviewEvent" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "itemId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "revision" INTEGER,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandVersion_version_key" ON "BrandVersion"("version");

-- CreateIndex
CREATE INDEX "BrandItem_status_idx" ON "BrandItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandItem_versionId_key_key" ON "BrandItem"("versionId", "key");

-- CreateIndex
CREATE INDEX "BrandReviewEvent_itemId_createdAt_idx" ON "BrandReviewEvent"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "BrandReviewEvent_versionId_createdAt_idx" ON "BrandReviewEvent"("versionId", "createdAt");

-- AddForeignKey
ALTER TABLE "BrandItem" ADD CONSTRAINT "BrandItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BrandVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandReviewEvent" ADD CONSTRAINT "BrandReviewEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BrandVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandReviewEvent" ADD CONSTRAINT "BrandReviewEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BrandItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── سجلُّ قرارات مراجعة الهوية لا يُعدَّل ولا يُحذف (الدالةُ من ترحيل الحوكمة)
CREATE TRIGGER "BrandReviewEvent_append_only"
  BEFORE UPDATE OR DELETE ON "BrandReviewEvent"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_append_only();
CREATE TRIGGER "BrandReviewEvent_no_truncate"
  BEFORE TRUNCATE ON "BrandReviewEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION tlaqi_append_only();

-- ── إصدارُ هويةٍ سارٍ واحد — والسارى لا يعود مسودّة، والمتقاعدُ لا يعود
CREATE OR REPLACE FUNCTION tlaqi_brand_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BRAND_VERSION_KEPT: إصدارُ الهوية لا يُحذف — يتقاعد ويبقى للرجوع';
  END IF;
  IF TG_OP = 'UPDATE' AND (
       (OLD."status" = 'active' AND NEW."status" NOT IN ('active', 'retired'))
    OR (OLD."status" = 'retired' AND NEW."status" <> 'retired')
  ) THEN
    RAISE EXCEPTION 'BRAND_VERSION_FLOW: انتقالٌ غير مسموح لإصدار الهوية';
  END IF;
  IF NEW."status" = 'active' AND EXISTS (
    SELECT 1 FROM "BrandVersion" v WHERE v."id" <> NEW."id" AND v."status" = 'active'
  ) THEN
    RAISE EXCEPTION 'BRAND_ACTIVE_EXISTS: للهوية إصدارٌ سارٍ — يتقاعد أولاً';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BrandVersion_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "BrandVersion"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_brand_version_guard();

-- ── عنصرُ الهوية لا يُحذف (سجلُّ ما أُعدّ وما اعتُمد يبقى)، والمنشورُ لا يعود
CREATE OR REPLACE FUNCTION tlaqi_brand_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BRAND_ITEM_KEPT: عنصرُ الهوية لا يُحذف';
  END IF;
  IF OLD."status" = 'published' AND NEW."status" <> 'published' THEN
    RAISE EXCEPTION 'BRAND_ITEM_PUBLISHED: العنصرُ المنشور لا يعود — يُعَدّ في إصدارٍ جديد';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BrandItem_guard"
  BEFORE UPDATE OR DELETE ON "BrandItem"
  FOR EACH ROW EXECUTE FUNCTION tlaqi_brand_item_guard();
