-- عدّاد نتائج التذاكر: يبقى بعد أرشفة التذاكر نفسها إلى الإكسل
CREATE TABLE "TicketTally" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "onTime" INTEGER NOT NULL DEFAULT 0,
    "late" INTEGER NOT NULL DEFAULT 0,
    "withdrawn" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketTally_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketTally_scope_key" ON "TicketTally"("scope");
