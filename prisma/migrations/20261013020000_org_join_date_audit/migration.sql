-- تاريخ الانضمام التنظيمي، وسجلّ تعديل التواريخ.
--
-- بعض الأعضاء انضمّوا لتَـــلاقِ قبل أن توجد المنصة، فتاريخُ حسابهم ليس
-- تاريخَ انضمامهم. وهي خمسة تواريخ لا تُخلَط: إنشاء الحساب، والانضمام
-- التنظيمي، وبداية التكليف الإداري، ونهايته، وإصدار الشهادة.
--
-- و`orgJoinDate` يبقى NULL لمن لا يُعرف تاريخه: لا يُخترَع تاريخٌ لمن
-- جُهل أمره، ولا يُنسَخ `joinDate` إليه فيُقرأ تصحيحاً وهو تخمين.
ALTER TABLE "Member" ADD COLUMN "orgJoinDate" TIMESTAMP(3);

-- تصحيحُ تاريخٍ تصرّفٌ يُراجَع: لأن التواريخ تحكم الاستحقاقات (شهادة
-- الثلاثة أشهر مثلاً)، يُحفظ ما كان وما صار ومن غيّره ومتى.
CREATE TABLE "MemberDateEdit" (
  "id"           TEXT NOT NULL,
  "memberId"     TEXT NOT NULL,
  "field"        TEXT NOT NULL,
  "previous"     TIMESTAMP(3),
  "next"         TIMESTAMP(3),
  "editedById"   TEXT,
  "editedByName" TEXT NOT NULL,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberDateEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberDateEdit_memberId_createdAt_idx" ON "MemberDateEdit"("memberId", "createdAt");

-- حذفُ العضو يُزيل سجلَّ تعديلاته معه (لا معنى له بلا صاحبه)،
-- وحذفُ المُعدِّل يُفرِغ معرّفه ويُبقي اسمه — فلا يُفقَد من فعل.
ALTER TABLE "MemberDateEdit" ADD CONSTRAINT "MemberDateEdit_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberDateEdit" ADD CONSTRAINT "MemberDateEdit_editedById_fkey"
  FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
