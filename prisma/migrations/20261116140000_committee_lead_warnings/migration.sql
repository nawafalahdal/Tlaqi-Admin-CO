-- تنبيهاتُ قائد اللجنة (قرار المؤسس ٣.٢ وق٤): جدولٌ جديد — إضافةٌ فقط، لا يتغيّر شيءٌ قائم.

-- CreateTable
CREATE TABLE "CommitteeLeadWarning" (
    "id" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "leadMemberId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "issuedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailStatus" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "CommitteeLeadWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeLeadWarning_committeeId_leadMemberId_createdAt_idx" ON "CommitteeLeadWarning"("committeeId", "leadMemberId", "createdAt");

-- AddForeignKey
ALTER TABLE "CommitteeLeadWarning" ADD CONSTRAINT "CommitteeLeadWarning_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeLeadWarning" ADD CONSTRAINT "CommitteeLeadWarning_leadMemberId_fkey" FOREIGN KEY ("leadMemberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

