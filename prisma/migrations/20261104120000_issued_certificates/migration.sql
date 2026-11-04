-- سجلُّ الشهادات الصادرة — إضافيٌّ بالكامل: جدولٌ جديد وفهارسُه ومفتاحٌ أجنبي.
-- لا يُغيّر صفّاً قائماً ولا عموداً ولا يحذف شيئاً. والشهاداتُ السابقة تبقى بروابطها.

-- CreateTable
CREATE TABLE "IssuedCertificate" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "edits" JSONB,
    "early" BOOLEAN NOT NULL DEFAULT false,
    "earlyReason" TEXT,
    "earlyReference" TEXT,
    "issuedById" TEXT,
    "issuedByName" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "IssuedCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCertificate_number_key" ON "IssuedCertificate"("number");

-- CreateIndex
CREATE INDEX "IssuedCertificate_issuedAt_idx" ON "IssuedCertificate"("issuedAt");

-- CreateIndex
CREATE INDEX "IssuedCertificate_kind_idx" ON "IssuedCertificate"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCertificate_memberId_occasion_key" ON "IssuedCertificate"("memberId", "occasion");

-- AddForeignKey
ALTER TABLE "IssuedCertificate" ADD CONSTRAINT "IssuedCertificate_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
