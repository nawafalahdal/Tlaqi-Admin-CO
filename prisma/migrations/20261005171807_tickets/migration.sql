-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "TicketStage" AS ENUM ('department', 'lead_escalation', 'ceo_escalation');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "targetDepartmentId" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "stage" "TicketStage" NOT NULL DEFAULT 'department',
    "stageDueAt" TIMESTAMP(3) NOT NULL,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
