-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "certificateIssuedAt" TIMESTAMP(3),
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "sheetRow" INTEGER,
ADD COLUMN     "terminatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "sheetRow" INTEGER,
ADD COLUMN     "ticketNumber" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");
