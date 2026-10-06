-- يتسلّم المرشّح بيانات دخول لحظة إنشاء حسابه بدل انتظار اجتياز الاختبار
ALTER TABLE "Member" ADD COLUMN "credentialsIssuedAt" TIMESTAMP(3);
ALTER TABLE "Member" ADD COLUMN "firstLoginAt" TIMESTAMP(3);
