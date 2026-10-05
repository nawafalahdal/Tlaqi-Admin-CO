export type TestQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
};

/** اختبار قبول عام موحّد (10 أسئلة) — معرفة أساسية بقيم ومنهجية تلاقي */
export const TEST_QUESTIONS: TestQuestion[] = [
  {
    id: "q1",
    prompt: "ما الهدف الأساسي من منصة تلاقي؟",
    options: [
      "إدارة دورة حياة الانضمام من القبول حتى الاعتماد",
      "نظام محاسبي للموظفين",
      "منصة تسويق خارجي",
      "أداة تواصل اجتماعي عام",
    ],
    correctIndex: 0,
  },
  {
    id: "q2",
    prompt: "كيف يدخل العضو الجديد إلى المنصة لأول مرة؟",
    options: [
      "عبر تسجيل عام مفتوح للجميع",
      "عبر رابط دعوة مخصص باسمه وإيميله",
      "عبر تطبيق جوال منفصل",
      "لا يحتاج دخول إطلاقاً",
    ],
    correctIndex: 1,
  },
  {
    id: "q3",
    prompt: "ما النسبة المطلوبة لاجتياز اختبار القبول؟",
    options: ["50%", "60%", "70%", "80%"],
    correctIndex: 3,
  },
  {
    id: "q4",
    prompt: "من يملك صلاحية إصدار دعوة جديدة؟",
    options: ["أي موظف", "أدمن القسم", "الإدارة العليا فقط", "المدعو نفسه"],
    correctIndex: 2,
  },
  {
    id: "q5",
    prompt: "ماذا يحدث إذا لم يحقق المرشح 80% في الاختبار؟",
    options: [
      "يُرفض نهائياً بلا رجعة",
      "يُنشأ طلب اجتماع شرح مع أدمن القسم",
      "تُحذف بياناته فوراً",
      "لا شيء",
    ],
    correctIndex: 1,
  },
  {
    id: "q6",
    prompt: "من يرى طلبات قسمه فقط ولا يرى طلبات الأقسام الأخرى؟",
    options: ["الإدارة العليا", "أدمن القسم", "المدعو", "الجميع"],
    correctIndex: 1,
  },
  {
    id: "q7",
    prompt: "أين يُسجَّل السجل الرسمي النهائي للأعضاء المعتمدين؟",
    options: ["في ملف Excel محلي", "في Google Sheet", "لا يُسجَّل", "في بريد إلكتروني"],
    correctIndex: 1,
  },
  {
    id: "q8",
    prompt: "ما مهلة تنفيذ طلب البانر الترحيبي لقسم التسويق بعد الاعتماد؟",
    options: ["يوم واحد", "يومان", "أسبوع", "لا توجد مهلة"],
    correctIndex: 1,
  },
  {
    id: "q9",
    prompt: "من يملك قرار تعديل أو إلغاء دعوة لم تُستخدم بعد؟",
    options: ["المدعو", "أدمن القسم", "الإدارة العليا فقط", "أي زائر"],
    correctIndex: 2,
  },
  {
    id: "q10",
    prompt: "كل حقل \"status\" في النظام له:",
    options: [
      "أكثر من مالك",
      "مالك واحد واضح ثابت",
      "لا مالك",
      "مالك يتغيّر يومياً",
    ],
    correctIndex: 1,
  },
];

export function scoreTest(answers: Record<string, number>) {
  let correct = 0;
  for (const q of TEST_QUESTIONS) {
    if (answers[q.id] === q.correctIndex) correct += 1;
  }
  return Math.round((correct / TEST_QUESTIONS.length) * 100);
}
