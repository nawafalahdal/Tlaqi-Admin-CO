# مصفوفة التحقق — تَـــلاقِ

> ما نُفّذ فعلاً، وأين، وبأي نتيجة. **محلي** = بناءٌ إنتاجي على قاعدة Postgres محلية ببيانات اختبار (لا بيانات أعضاء
> حقيقيين). **Vercel** = تحقّقٌ على النشر نفسه. ما لم يُنفَّذ مكتوبٌ «لم يُنفَّذ» — لا يُفترض نجاحه.
>
> آخر تحديث: 2026-11-02 — فرع `claude/platform-audit`، آخر التزام مُختبَر: انظر §٥.

## ١) الفحوص الساكنة والبناء (محلي)

| الفحص | الأمر | النتيجة |
|---|---|---|
| الأنواع | `npx tsc --noEmit` | ✅ بلا أخطاء (بعد كل التزام) |
| الأسلوب | `npx eslint .` | ✅ 0 أخطاء، 4 تحذيرات `<img>` قائمة قبل التدقيق |
| البناء الإنتاجي | `next build` (Next.js 16.4.4، Turbopack) | ✅ نجح (`Compiled successfully`) |
| تكافؤ مفاتيح ar/en | `en: Dictionary` — المترجم يفرضه | ✅ (tsc) |
| تحذيرات الاعتماديات (إنتاج) | `npm audit --omit=dev` | ⚠ 3 «عالية» عبر `prisma` ← `deepmerge-ts` (O-01)؛ 0 حرجة |

## ٢) الانحدار الكامل (محلي، خادم `next start` على :3000)

شُغّلت 46 مجموعة على البناء بعد `4e4db56` (الأداء + المحتوى): **1,509 فحصاً ناجحاً، فشلٌ واحد** — `e2e-succession`،
وسببه اعتمادُ الفحص على بيانات القاعدة (فشل كذلك في أساس P0 قبل أي تغيير). أُصلح في `03e2c1d` (التوقّع لم يتغيّر).

| المجموعة | نجح | فشل |
|---|---|---|
| `e2e-approvals.ts` | 42 | 0 |
| `e2e-avatars.ts` | 22 | 0 |
| `e2e-ceo-invites-operations.ts` | 10 | 0 |
| `e2e-committees.ts` | 40 | 0 |
| `e2e-cron-auth.ts` | 17 | 0 |
| `e2e-department-governance.ts` | 18 | 0 |
| `e2e-departments.ts` | 22 | 0 |
| `e2e-early-exit-certificate.ts` | 12 | 0 |
| `e2e-email-policy.ts` | 19 | 0 |
| `e2e-execution.ts` | 121 | 0 |
| `e2e-external-links.ts` | 35 | 0 |
| `e2e-founder-admin.ts` | 61 | 0 |
| `e2e-founder-dates.ts` | 22 | 0 |
| `e2e-improvements.ts` | 38 | 0 |
| `e2e-invite-flow.ts` | 19 | 0 |
| `e2e-marketing-execution.ts` | 172 | 0 |
| `e2e-marketing-governance.ts` | 85 | 0 |
| `e2e-marketing-jobs.ts` | 55 | 0 |
| `e2e-marketing-workflow.ts` | 96 | 0 |
| `e2e-marketing.ts` | 96 | 0 |
| `e2e-member-roster.ts` | 9 | 0 |
| `e2e-org-chart.ts` | 26 | 0 |
| `e2e-plans.ts` | 35 | 0 |
| `e2e-reports.ts` | 22 | 0 |
| `e2e-retention.ts` | 15 | 0 |
| `e2e-signatures.ts` | 23 | 0 |
| `e2e-succession.ts` | 18 | 1 ← أُصلح: **19/0** في الإعادة |
| `e2e-sweep-throttle.ts` | 9 | 0 |
| `e2e-termination.ts` | 31 | 0 |
| `e2e-ticket-excel.ts` | 11 | 0 |
| `e2e-ticket-lifecycle.ts` | 34 | 0 |
| `e2e-ticket-link.ts` | 10 | 0 |
| `e2e-ticket-withdrawal.ts` | 20 | 0 |
| `e2e-welcome-delivery.ts` | 30 | 0 |
| `e2e-welcome-once.ts` | 12 | 0 |
| `check-marketing-ai.ts` | 59 | 0 |
| `check-marketing-formats.ts` | 34 | 0 |
| `load-marketing-jobs.ts` | 18 | 0 |
| `check-deployment-env.ts` | 29 | 0 |
| `check-migration-policy.ts` | 40 | 0 |
| `check-department-scope.ts` | 1 | 0 |
| `check-member-roster.ts` | 1 | 0 |
| `check-email-coverage.ts` | 1 | 0 |
| `check-banner-render.ts` | 2 | 0 |
| `check-erased-leader-login.ts` | 4 | 0 |
| `check-discontinued-features.ts` | 13 | 0 |

## ٣) إعادة التشغيل على البناء النهائي (بعد `3f64991` و`03e2c1d`)

نصوص الرسائل تغيّرت في ملفات `src/lib` التي تستوردها الفحوص مباشرة؛ أُعيد البناء وأُعيدت المجموعات التي تمسّها:

| المجموعة | النتيجة |
|---|---|
| `e2e-execution` 121، `e2e-committees` 40، `e2e-plans` 35، `e2e-improvements` 38، `e2e-ticket-lifecycle` 34، `e2e-approvals` 42، `e2e-department-governance` 18، `e2e-departments` 22، `e2e-succession` 19، `e2e-org-chart` 26، `e2e-member-roster` 9، `check-member-roster` 1، `check-department-scope` 1، `e2e-marketing-governance` 85 | ✅ **491/491** |
| `e2e-leader-role.ts` (قاعدة P0 المحلية، دخولٌ حقيقي عبر HTTP) | ✅ **69/69** |
| `check-pagination.ts` (300 عضو) | ✅ **12/12** |
| بعد `d94ebd9` (إزالة الشيفرة الميتة): `check-discontinued-features` | ✅ **14/14** |
| بعد `d94ebd9`: `e2e-email-policy`، `check-email-coverage` | ✅ ALL PASS |
| بعد `7952941` (حارس قائمة القسم): بناء، `check-member-roster` (18 قائمة)، `check-pagination` 12/12، `e2e-department-governance` 18، `e2e-member-roster` 9، `e2e-departments` 22، `e2e-committees` 40، `check-department-scope` | ✅ |

## ٤) متطلبات التوجيه ← الدليل

| المتطلب | الدليل | أين تحقّق |
|---|---|---|
| إيقاف تذكير التحقق الثنائي من كل مصادره، ومنها الشيت | `check-discontinued-features` §٢–٣: تشغيلان للكنس = صفر أسطر؛ المكتوم لا يُنسخ | محلي |
| عدم تعطيل التحقق الثنائي نفسه | الفحص نفسه §٤ + `e2e-leader-role` (الدخول بالرمز) | محلي |
| اختبار انحدار يمنع العودة | `check-discontinued-features.ts` ضمن مجموعة الانحدار | محلي |
| الأهداف: المؤسس/الرئيس يعتمدان والقادة يقترحون | `e2e-execution` + `canApproveGoal`/`createGoal` | محلي |
| حصر القسم | `check-department-scope`، `e2e-department-governance` | محلي |
| اعتماد التسويق: القائد + التشغيل معاً، والرئيس يطّلع | `e2e-marketing-governance` 85، `e2e-leader-role` (سلسلة الحملة بمرحلتين) | محلي |
| وكيل التسويق لا يتجاوز الاعتماد | `check-marketing-ai` 59، `e2e-marketing-workflow` 96 | محلي (بمزوّد وهمي — لا نداء حقيقي لـClaude في هذا التدقيق) |
| الترحيل بلا تكرار | `e2e-execution` (سجلٌّ فريد لكل مهمة/فترة، تصعيدٌ عند 3) | محلي |
| دورة حياة اللجان | `e2e-committees` 40 | محلي |
| الدعوات بلا تكرار | `e2e-invite-flow`، `e2e-welcome-once`، `e2e-approvals` | محلي |
| حماية الكنس اليومي (Bearer، فشلٌ مغلق) | `e2e-cron-auth` 17 | محلي |
| عزل المعاينة عن الإنتاج | `check-deployment-env` 29، `check-migration-policy` 40 | محلي |
| أداء: p50/p95 بحجم بيانات معلوم | `perf-platform.ts` — `TLAQI_PERFORMANCE_REPORT.md` | محلي |

## ٥) ما تحقّق في Vercel / الإنتاج

| البند | الحالة |
|---|---|
| نشر P0 (`8243e1e`) | ✅ منشور ومتحقَّق سابقاً (`dpl_2V5YutD6U9uYyxHma3aqkEuARHSv`) |
| أخطاء التشغيل قبل التدقيق | ✅ صفر في آخر 7 أيام (عند بدء التدقيق) |
| معاينة `95f2136` (`dpl_BsvQSqD9ZJL6pgHHj3qGxuBXPQcn`) | ✅ READY — Next.js 16.4.4؛ «لا ترحيل: معاينة»؛ فحوص ما قبل البناء كلها ناجحة؛ الصفحة مغلقةٌ عند الشك («هذه المعاينة غير معزولة عن الإنتاج») |
| **نشر الإنتاج** `dpl_BKoaS5bNaLmAddEaWtM8yXzUS6w2` (`95f2136`، إعادة نشر المعاينة المتحقَّقة) | ✅ READY، والأسماء: `tlaqiteam.site`، `www.tlaqiteam.site`، `tlaqi-admin-co.vercel.app` — بلا خطأ إسناد |
| الترحيل في بناء الإنتاج | ✅ «No pending migrations to apply» (44 ترحيلاً، لا جديد) |
| `GET /login` (الإنتاج) | ✅ 200 — نموذج الدخول الحقيقي |
| `GET /admin/people` بلا جلسة | ✅ 307 ← `/login?callbackUrl=%2Fadmin%2Fpeople`، والرؤوس الأمنية كلها حاضرة |
| `GET /api/cron/sweep` بلا السر | ✅ 401 (أداة الجلب لا تميّز 401 التطبيق من 401 حماية Vercel — مذكورٌ كما هو) |
| أخطاء التشغيل بعد النشر | ✅ صفر (ساعة بعد النشر) |
| أول كنسٍ يومي بعد النشر (2026-11-03 03:17 UTC) | ⏳ فحصٌ مجدول بعده بدقائق (السجل يُحفظ ساعة) |
| نقطة الرجوع | `dpl_2V5YutD6U9uYyxHma3aqkEuARHSv` (`8243e1e`) |
| `audit-data-integrity.ts` على قاعدة الإنتاج | ❌ **لم يُنفَّذ** — يحتاج موافقة (O-11) |
| حساب ليان في الإنتاج | ❌ **لم يُتحقَّق** (O-10) |
| نداءٌ حقيقي لـClaude | ❌ لم يُنفَّذ في هذا التدقيق |
| كتابةٌ حقيقية في Google Sheets / إرسال Resend | ❌ لم يُنفَّذ (لا آثار جانبية على الإنتاج) |
