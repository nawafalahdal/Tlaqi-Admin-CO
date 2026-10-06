-- تنحية حساب قيادي تُعطّله وتُفرِغ منصبه، دون حذف سجله
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "removalReason" TEXT;
