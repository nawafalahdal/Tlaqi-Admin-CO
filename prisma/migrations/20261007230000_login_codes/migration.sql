-- رمز دخول من ست خانات يُرسَل بالبريد بعد صحّة كلمة المرور
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginCode_email_idx" ON "LoginCode"("email");
CREATE INDEX "LoginCode_expiresAt_idx" ON "LoginCode"("expiresAt");
