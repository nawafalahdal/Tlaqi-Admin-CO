import Link from "next/link";
import { Card } from "./ui";

export type ReadinessRow = {
  key: string;
  label: string;
  owner: string;
  /** عددُ الأسئلة الفعلي — `0` للبنك الفارغ أو غير المُنشأ */
  questions: number;
  /** رابطُ التعديل يظهر لصاحب البنك وحده — غيرُه يُردّ من الصفحة أصلاً */
  editHref?: string;
};

type Labels = {
  title: string;
  hint: string;
  allReady: string;
  someEmpty: string;
  ready: string;
  empty: string;
  edit: string;
  email: string;
  emailOn: string;
  emailOff: string;
};

/** جاهزيةُ الدعوات — قبل أن يملأ أحدٌ نموذجاً سيُرفض.
 *
 *  كلُّ دعوةٍ تحمل اختباراً من بنك منصبها، والخادمُ يرفض الدعوة إلى بنكٍ
 *  فارغ (وإلا رسب المرشّح آلياً بـ٠٪). فكان صاحبُ الدعوة يعرف ذلك من
 *  رسالة خطأٍ بعد الإرسال. وهنا يراه قبله، بالأرقام الفعلية من القاعدة:
 *  أيُّ بنكٍ جاهز، وأيُّها فارغ، ومن يُعدّه. */
export function InviteReadiness({
  rows,
  emailEnabled,
  labels: L,
}: {
  rows: ReadinessRow[];
  emailEnabled: boolean;
  labels: Labels;
}) {
  const emptyCount = rows.filter((r) => r.questions === 0).length;

  return (
    <section aria-labelledby="readiness-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="readiness-title" className="text-base font-bold sm:text-lg">
          {L.title}
        </h2>
        <p
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            emptyCount === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
          }`}
        >
          {emptyCount === 0 ? L.allReady : L.someEmpty.replace("{n}", String(emptyCount))}
        </p>
      </div>
      <p className="mb-3 text-sm leading-relaxed text-black/50">{L.hint}</p>

      <Card className="overflow-hidden">
        <ul className="readiness-list">
          {rows.map((r) => {
            const ok = r.questions > 0;
            return (
              <li key={r.key} className="readiness-row">
                <span
                  aria-hidden="true"
                  className={`readiness-dot ${ok ? "readiness-dot--ok" : "readiness-dot--empty"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.label}</p>
                  <p className="text-xs text-black/45">{r.owner}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                  }`}
                >
                  {ok ? L.ready.replace("{n}", String(r.questions)) : L.empty}
                </span>
                {r.editHref && (
                  <Link
                    href={r.editHref}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-black/60 underline-offset-4 hover:bg-black/[0.04] hover:underline"
                  >
                    {L.edit}
                  </Link>
                )}
              </li>
            );
          })}
          <li className="readiness-row">
            <span
              aria-hidden="true"
              className={`readiness-dot ${emailEnabled ? "readiness-dot--ok" : "readiness-dot--empty"}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{L.email}</p>
              <p className="text-xs text-black/45">{emailEnabled ? L.emailOn : L.emailOff}</p>
            </div>
          </li>
        </ul>
      </Card>
    </section>
  );
}
