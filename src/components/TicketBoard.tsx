import Link from "next/link";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { TICKET_STAGE_LABELS, ticketAuthor, ticketTargetLabel, type FullTicket } from "@/lib/tickets";
import { getLocale, getDictionary } from "@/i18n/server";
import { googleCalendarUrl } from "@/lib/calendar";
import type { themeFromColor } from "@/lib/brand";

/** لوحة التذاكر الدائمة.
 *
 *  التذاكر هي قناة العمل، فمكانها أعلى كل لوحة لا صفحةً يُذهب إليها.
 *  وتُقسَّم بما يُسأل عنه فعلاً: ما لم يُرَدّ عليه بعد، وما يُعالَج الآن،
 *  وما تجاوز مهلته — فالمتأخّر لا يختبئ بين المفتوح. */
export async function TicketBoard({
  data,
  theme,
}: {
  /** الأعدادُ والستُّ الأقربُ — من `ticketBoardData`، لا القائمةُ كلّها */
  data: { counts: { late: number; untouched: number; working: number; mine: number; open: number }; top: FullTicket[] };
  theme: ReturnType<typeof themeFromColor>;
  /** لم يعُد يُستعمل هنا — «تذاكري» تُعدّ في القاعدة */
  viewerId?: string;
}) {
  const t = getDictionary(await getLocale());
  const tb = t.ticketBoard;
  // هذا مكوّن خادم غير متزامن (`async`): يُنفَّذ مرّةً لكل طلب على
  // الخادم، فـ`Date.now()` هنا لحظةُ الطلب لا قيمةٌ تتبدّل بين إعادات
  // الرسم. وقاعدة `react-hooks/purity` لا تُميّز مكوّنات الخادم فتعدّه
  // نجاسةً — وهو إنذارٌ كاذب لا عطب.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const { counts, top } = data;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold sm:text-lg">{tb.title}</h2>
          <p className="text-xs text-black/45">{tb.hint}</p>
        </div>
        <Link
          href="/admin/tickets"
          className="min-h-11 rounded-xl px-4 text-sm font-semibold leading-[2.75rem]"
          style={{ background: theme.fill, color: "#fff" }}
        >
          {tb.openAll}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={tb.late} value={counts.late} tone="alarm" />
        <Tile label={tb.untouched} value={counts.untouched} tone="warn" />
        <Tile label={tb.working} value={counts.working} tone="plain" />
        <Tile label={tb.mine} value={counts.mine} tone="plain" />
      </div>

      {counts.open === 0 ? (
        <Card className="mt-3 p-6 text-center text-sm text-black/40">{tb.empty}</Card>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {/* المتأخّر أولاً دائماً: ترتيب القائمة هو ترتيب الأولوية */}
          {top.map((x) => {
            const isLate = now > x.stageDueAt.getTime();
            return (
              <Card key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3.5">
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ background: theme.surface, color: theme.onSurface }}
                  >
                    #{x.ticketNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{x.subject}</span>
                  {isLate && (
                    <span className="shrink-0 rounded-full bg-[#FBE5E1] px-2 py-0.5 text-xs font-bold text-[#9A2E1C]">
                      {tb.lateBadge}
                    </span>
                  )}
                  <span className="w-full text-xs text-black/45">
                    {ticketAuthor(x).name} ← {ticketTargetLabel(x)} · {TICKET_STAGE_LABELS[x.stage]} ·{" "}
                    {formatDate(x.stageDueAt)}
                  </span>
                  <div className="flex w-full flex-wrap gap-2 pt-1">
                    <Link
                      href="/admin/tickets"
                      className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-semibold text-black/60 hover:bg-black/[0.03]"
                    >
                      {tb.openTicket}
                    </Link>
                    {/* تقويم جوجل أولاً لأن تعامل الفريق معه دائم: يفتح
                        نموذج الحدث جاهزاً فيُحفظ بضغطة. وملفّ .ics إلى
                        جانبه لتقويم آبل وأوتلوك ولمن ليس مسجَّلاً دخوله.
                        وكلاهما حدثٌ يُضاف بيد صاحبه، لا مزامنة ولا وصول
                        من المنصة إلى تقويم أحد. */}
                    <a
                      href={googleCalendarUrl({
                        title: `تذكرة #${x.ticketNumber}: ${x.subject}`,
                        details: `${x.description}\n\nمن: ${ticketAuthor(x).name}\nإلى: ${ticketTargetLabel(x)}\nالمرحلة: ${TICKET_STAGE_LABELS[x.stage]}`,
                        start: new Date(x.stageDueAt.getTime() - 3600_000),
                        end: x.stageDueAt,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-on-brand"
                      style={{ background: theme.fill }}
                    >
                      {tb.addToGoogle}
                    </a>
                    <a
                      href={`/api/tickets/${x.id}/calendar`}
                      className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-semibold text-black/60 hover:bg-black/[0.03]"
                    >
                      {tb.addToCalendar}
                    </a>
                  </div>
              </Card>
            );
          })}
          {counts.open > top.length && (
            <p className="pt-1 text-center text-xs text-black/40">
              {tb.more.replace("{n}", String(counts.open - top.length))}
            </p>
          )}
        </div>
      )}

    </section>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "alarm" | "warn" | "plain" }) {
  const color = tone === "alarm" ? "#9A2E1C" : tone === "warn" ? "#B3701A" : "rgba(0,0,0,0.75)";
  return (
    <Card className="p-3.5">
      <p className="text-2xl font-bold leading-none" style={{ color }}>
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-snug text-black/45">{label}</p>
    </Card>
  );
}
