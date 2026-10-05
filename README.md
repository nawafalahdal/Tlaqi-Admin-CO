# تلاقي — منصة القبول والتسجيل والإدارة (المرحلة الأولى)

منصة داخلية تدير دورة حياة الانضمام: دعوة → اختبار قبول → اعتماد، مع نظام طلبات تلقائي بين الأقسام. مبنية على Next.js (App Router) + Prisma + PostgreSQL + Tailwind CSS 4، بهوية بصرية كاملة لعلامة **تلاقي**.

## الهوية البصرية

كل قسم له لون خاص يظهر تلقائياً في كل الشاشات المرتبطة به:

| القسم / الدور | اللون |
| --- | --- |
| الإدارة العليا (Temptress) | `#341D2B` |
| التسويق (Mahogany) | `#C34900` |
| الموارد البشرية (Beige) | `#EEF6DF` |
| التقنية (Green Sheen) | `#67C090` |

الخط: **Cairo** (عربي/لاتيني) عبر `next/font/google`. الشعار وملف الهوية الكامل في `public/brand/`.

## التشغيل محلياً

```bash
npm install
cp .env.example .env   # ثم عدّل القيم (خصوصاً DATABASE_URL)
npx prisma migrate dev
npm run db:seed        # ينشئ الإدارة العليا وأدمن كل قسم بكلمة مرور Tlaqi@2026
npm run dev
```

افتح `http://localhost:3000` — يحوّلك تلقائياً لصفحة الدخول.

### حسابات تجريبية (بعد التشغيل)

| البريد | كلمة المرور | الدور |
| --- | --- | --- |
| super.admin@tlaqi.co | Tlaqi@2026 | الإدارة العليا |
| marketing.admin@tlaqi.co | Tlaqi@2026 | أدمن التسويق |
| hr.admin@tlaqi.co | Tlaqi@2026 | أدمن الموارد البشرية |
| tech.admin@tlaqi.co | Tlaqi@2026 | أدمن التقنية |

**غيّر كلمات المرور هذه قبل أي استخدام فعلي.**

## التكاملات الخارجية (اختيارية)

التطبيق يعمل بالكامل بدونها؛ في حال عدم ضبطها يتم تسجيل العملية في الـ console فقط دون كسر أي تدفق:

- **البريد الإلكتروني**: عبر [Resend](https://resend.com) — اضبط `RESEND_API_KEY` و `EMAIL_FROM`.
- **Google Sheets** (السجل الرسمي للأعضاء المعتمدين): أنشئ Service Account وشارك الشيت معه، ثم اضبط `GOOGLE_SHEETS_CLIENT_EMAIL` و `GOOGLE_SHEETS_PRIVATE_KEY` و `GOOGLE_SHEETS_SPREADSHEET_ID`.

## أوامر مفيدة

```bash
npm run db:migrate   # prisma migrate dev
npm run db:seed       # إعادة تشغيل بذور البيانات
npm run lint
npm run build
```

## البنية

- `src/app/login` — دخول الإدارة (NextAuth Credentials)
- `src/app/admin` — لوحة الإدارة العليا (إصدار دعوات، اعتماد نهائي، نظرة شاملة على الطلبات)
- `src/app/admin/departments/[slug]` — لوحة أدمن القسم (Kanban: جديد/قيد التنفيذ/متأخر/منجز)
- `src/app/invite/[token]` — صفحة المرشح: تأكيد الهوية ← اختبار قبول (10 أسئلة، نسبة النجاح 80%) ← النتيجة
- `src/lib/workflow.ts` — منطق الأعمال: التسجيل، الاعتماد، الطلبات التلقائية بين الأقسام، تمييز المتأخر
- `src/lib/brand.ts` / `src/lib/colors.ts` — نظام الألوان وتوليد الثيمات لكل قسم
- `prisma/schema.prisma` — نموذج البيانات (Invite, Member, TestAttempt, Request, Department, User)
