import { SeatCard, OrgCard } from "@/components/OrgCard";
import { ORG_SENIOR_COLOR, outlineFor, needsOutline } from "@/lib/orgChart";
import type { OrgChart } from "@/lib/orgChart";

/** الهيكل شجرةً واحدة موصولة — لا بطاقاتٍ في صناديق متفرّقة.
 *
 *  **العطب الذي يُصلحه هذا المكوّن:** كانت الأقسام تُعرَض بطاقاتٍ
 *  مستقلّة بعضها تحت بعض، فيُقرأ الهيكل قوائمَ متجاورة لا سلسلةَ
 *  إدارة — ولا يُرى من يتبع من. والإدارة العليا كانت تُكرَّر صفّاً بين
 *  الأقسام وهي ليست فرعاً منها.
 *
 *  فصار: المؤسس ثم التنفيذي في العمود الأوسط، والإدارة العليا وما
 *  يتبع التنفيذي **معهما في الأعلى**، ثم شريطٌ أفقيٌّ واحد تتفرّع منه
 *  الأقسام بخطوطٍ رأسية — فيُقرأ الانتماء بالخط لا بالترتيب.
 *
 *  والخطوط رسمٌ خالص (`div` بحدود): لا SVG ولا مكتبة. وتبقى في
 *  الطباعة لأن `print-color-adjust: exact` يُفرَض في صفحة الطباعة،
 *  فالنسخة المنزَّلة تحمل الشجرة نفسها لا بطاقاتٍ عائمة.
 */
export function OrgTree({
  chart,
  viewerId,
  viewerDepartmentId,
  compact = false,
}: {
  chart: OrgChart;
  /** معرّف من يُشاهد — تُميَّز بطاقتُه أينما وقعت */
  viewerId?: string;
  /** قسمُ من يُشاهد — يُميَّز فرعُه كلّه لا بطاقتُه وحدها.
   *
   *  وهذا لقائد القسم خاصّةً: موضعُه ليس بطاقتَه فقط، بل فرعُه —
   *  قسمُه بقائده وأعضائه. فيُحاط الفرع بإطارٍ خفيفٍ بلون القسم،
   *  وتبقى بطاقتُه هو وحدها بالحلقة البرتقالية و«أنت هنا». */
  viewerDepartmentId?: string | null;
  /** نسخة الطباعة: مقاساتٌ أصغر لتسع الورقة */
  compact?: boolean;
}) {
  const size = compact ? "sm" : "md";

  return (
    <div className="flex flex-col items-center">
      {/* ── القمّة: المؤسس */}
      <SeatCard seat={chart.founder} color={ORG_SENIOR_COLOR} size={compact ? "md" : "lg"} viewerId={viewerId} />
      <Trunk />

      {/* ── الرئيس التنفيذي */}
      <SeatCard seat={chart.ceo} color={ORG_SENIOR_COLOR} size={compact ? "md" : "lg"} viewerId={viewerId} />

      {/* ── الطبقة العليا: الإدارة العليا وما يتبع التنفيذي — في الأعلى
            مع المؤسس والتنفيذي، لا صفّاً مكرّراً تحت الأقسام */}
      {(chart.senior || chart.underCeo.length > 0) && (
        <>
          <Trunk />
          <div
            className="w-full max-w-3xl rounded-2xl px-4 py-4"
            style={{
              background: `${ORG_SENIOR_COLOR}0A`,
              border: `1px solid ${ORG_SENIOR_COLOR}29`,
            }}
          >
            <p className="mb-3 text-center text-[11px] font-bold tracking-wider text-black/45">
              {chart.senior ? chart.senior.name : "تابعٌ للرئيس التنفيذي"}
              <span className="mx-1.5 text-black/20">•</span>
              الطبقة القيادية
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {chart.senior?.lead.kind === "filled" && (
                <SeatCard seat={chart.senior.lead} color={ORG_SENIOR_COLOR} size={size} viewerId={viewerId} />
              )}
              {chart.senior?.members.map((m) => (
                <OrgCard
                  key={m.id}
                  person={m}
                  color={ORG_SENIOR_COLOR}
                  size={size}
                  highlight={m.id === viewerId}
                />
              ))}
              {chart.underCeo.map((seat, i) => (
                <SeatCard key={i} seat={seat} color={ORG_SENIOR_COLOR} size={size} viewerId={viewerId} />
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── الأقسام: تتفرّع من شريطٍ واحد، فيُقرأ أنها إخوةٌ تحت التنفيذي */}
      {chart.departments.length > 0 && (
        <>
          <Trunk />
          <Branching count={chart.departments.length} />
          <div className="flex w-full flex-wrap items-start justify-center gap-4">
            {chart.departments.map((d) => {
              const mine = Boolean(viewerDepartmentId) && d.id === viewerDepartmentId;
              return (
              <div
                key={d.id}
                className={`flex flex-col items-center rounded-3xl ${mine ? "px-2 pb-2" : ""}`}
                style={
                  mine
                    ? {
                        background: `${d.displayColor}0A`,
                        boxShadow: `0 0 0 2px ${outlineFor(d.displayColor)}`,
                      }
                    : undefined
                }
              >
                {mine && (
                  <span
                    className="mt-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold text-white"
                    style={{ background: needsOutline(d.displayColor) ? "#341D2B" : d.displayColor }}
                  >
                    قسمك
                  </span>
                )}
                {/* ساقُ الفرع تصل الشريطَ بترويسة القسم */}
                <span className="block h-4 w-px" style={{ background: outlineFor(d.displayColor) }} aria-hidden />
                <div
                  className="rounded-xl px-3 py-1.5"
                  style={{
                    background: needsOutline(d.displayColor) ? "#F6F7F1" : `${d.displayColor}14`,
                    border: `1.5px solid ${outlineFor(d.displayColor)}`,
                  }}
                >
                  <span className="text-xs font-bold text-black/80">{d.name}</span>
                </div>
                <span className="block h-4 w-px" style={{ background: outlineFor(d.displayColor) }} aria-hidden />

                <SeatCard seat={d.lead} color={d.displayColor} size={size} viewerId={viewerId} />

                {d.members.length > 0 && (
                  <>
                    <span
                      className="block h-4 w-px"
                      style={{ background: outlineFor(d.displayColor) }}
                      aria-hidden
                    />
                    <div
                      className="flex flex-col items-center gap-2 rounded-2xl px-2.5 py-3"
                      style={{ borderTop: `2px solid ${outlineFor(d.displayColor)}` }}
                    >
                      <div className="flex flex-wrap justify-center gap-2.5">
                        {d.members.map((m) => (
                          <OrgCard
                            key={m.id}
                            person={m}
                            color={d.displayColor}
                            size="sm"
                            highlight={m.id === viewerId}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {d.members.length === 0 && (
                  <p className="mt-2 text-[11px] text-black/35">لا أعضاء بعد</p>
                )}
              </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── غير المصنّفين: يُعرضون ولا يُخفَون — الهيكل يقول الحقيقة */}
      {chart.unassigned.length > 0 && (
        <div className="mt-6 w-full rounded-2xl border border-dashed border-black/15 px-4 py-4">
          <p className="mb-2 text-center text-[11px] font-bold text-black/45">
            معتمدون بلا قسم — خارج السلسلة حتى يُصنَّفوا
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {chart.unassigned.map((m) => (
              <OrgCard
                key={m.id}
                person={m}
                color="#8A9470"
                size="sm"
                highlight={m.id === viewerId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** الجذع: خطٌّ رأسيٌّ يصل مستوىً بما تحته */
function Trunk() {
  return <span className="my-1.5 block h-6 w-px bg-black/20 print:bg-black/40" aria-hidden />;
}

/** الشريط الأفقي الذي تتفرّع منه الأقسام.
 *
 *  وبقسمٍ واحد لا يُرسَم شريط: خطٌّ أفقيٌّ لفرعٍ واحد يقول تفرّعاً لا
 *  وجود له. */
function Branching({ count }: { count: number }) {
  if (count <= 1) return null;
  return (
    <span
      className="mb-0 block h-px w-full max-w-5xl bg-black/20 print:bg-black/40"
      aria-hidden
    />
  );
}
