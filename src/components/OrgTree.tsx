import { SeatCard, OrgCard } from "@/components/OrgCard";
import { readableTextOn } from "@/lib/colors";
import type { OrgPerson } from "@/lib/orgChart";
import { ORG_SENIOR_COLOR, outlineFor, needsOutline } from "@/lib/orgChart";
import type { OrgChart, OrgDepartment } from "@/lib/orgChart";

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
            {chart.departments.map((d) => (
              <Branch
                key={d.id}
                dept={d}
                size={size}
                viewerId={viewerId}
                viewerDepartmentId={viewerDepartmentId}
              />
            ))}
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

/** فرعٌ في الشجرة: قسمٌ أو لجنة — ويرسم نفسه بنفسه في العمق كلِّه.
 *
 *  **واللجنةُ تُرسَم داخل إطار أبيها لا بجانبه، وبلونه لا بلونٍ غريب.**
 *  فلو عُرضت صفّاً مع الأقسام لقُرئت قسماً ثالثاً، ولو حملت لوناً
 *  خاصاً بها لانقطع نسبُها إلى قسمها. فهي بلون قسمها، ويُميّزها
 *  **شكلُها**: إطارٌ متقطّعٌ حولها، ووسمُ «لجنة» على ترويستها، ووسمٌ
 *  على بطاقة قائدها وكلِّ عضوٍ فيها.
 *
 *  والتكرارُ ذاتيٌّ (`Branch` يُنادي نفسه) لأن المسار نفسه يدور: لجنةٌ
 *  في لجنة. والعمقُ محدودٌ عند الاقتراح لا عند الرسم. */
function Branch({
  dept,
  size,
  viewerId,
  viewerDepartmentId,
  depth = 0,
}: {
  dept: OrgDepartment;
  size: "sm" | "md";
  viewerId?: string;
  viewerDepartmentId?: string | null;
  depth?: number;
}) {
  const mine = Boolean(viewerDepartmentId) && dept.id === viewerDepartmentId;
  const stem = outlineFor(dept.displayColor);
  // بطاقاتُ اللجان أصغر: فرعٌ داخل فرعٍ يحتاج تفاوتاً يُقرأ به العمق
  const seatSize = depth > 0 ? "sm" : size;

  const people = dept.members.length + (dept.lead.kind === "filled" ? 1 : 0);
  const headInk = readableTextOn(needsOutline(dept.displayColor) ? "#F1F5E6" : dept.displayColor);

  // **القسمُ لوحةٌ لا عمود:** ترويسةٌ بلونه فيها اسمُه وعددُه، وتحتها قائدُه
  // بطاقةً، وأعضاؤه شرائحَ — فيُقرأ القسمُ وحدةً واحدة، ويتّسع لعشرين
  // عضواً دون أن يطول الهيكل عشرين بطاقة.
  return (
    <div className="flex min-w-[15rem] flex-1 basis-64 flex-col items-stretch">
      {/* ساقُ الفرع تصل الشريطَ بترويسة القسم */}
      <span className="mx-auto block h-4 w-px" style={{ background: stem }} aria-hidden />
      <div
        className={`overflow-hidden rounded-3xl bg-white shadow-sm ${dept.isCommittee ? "border border-dashed" : "border border-hairline"}`}
        style={mine ? { boxShadow: `0 0 0 2px ${stem}` } : dept.isCommittee ? { borderColor: stem } : undefined}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5"
          style={{
            background: needsOutline(dept.displayColor) ? "#F1F5E6" : dept.displayColor,
            color: headInk,
            borderBottom: needsOutline(dept.displayColor) ? `1px solid ${stem}` : undefined,
          }}
        >
          <span className="text-sm font-bold">
            {/* لونُها لونُ قسمها، فالكلمةُ والتقطيعُ هما ما يُميّزانها */}
            {dept.isCommittee ? `لجنة ${dept.name}` : dept.name}
            {mine && <span className="ms-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] text-[#341D2B]">{dept.isCommittee ? "لجنتك" : "قسمك"}</span>}
          </span>
          <span className="text-[11px] font-bold opacity-80">{people} أشخاص</span>
        </div>

        <div className="flex flex-col items-center px-3 pb-4 pt-4">
          <SeatCard
            seat={dept.lead}
            color={dept.displayColor}
            size={seatSize}
            viewerId={viewerId}
            committee={dept.isCommittee ? dept.name : null}
          />

          {dept.members.length > 0 ? (
            <>
              <span className="block h-3 w-px" style={{ background: stem }} aria-hidden />
              <ul className="flex flex-wrap justify-center gap-2">
                {dept.members.map((m) => (
                  <li key={m.id}>
                    <MemberChip person={m} color={dept.displayColor} highlight={m.id === viewerId} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-[11px] text-black/35">لا أعضاء بعد</p>
          )}
        </div>
      </div>

      {/* لجانُه: داخل إطارٍ بلون أبيها، وكلُّ لجنةٍ بلونها هي */}
      {dept.committees.length > 0 && (
        <>
          <span className="block h-4 w-px" style={{ background: stem }} aria-hidden />
          <div
            className="flex flex-wrap items-start justify-center gap-3 rounded-2xl px-2 pb-2"
            style={{ border: `1px dashed ${stem}` }}
          >
            {dept.committees.map((c) => (
              <Branch
                key={c.id}
                dept={c}
                size={size}
                viewerId={viewerId}
                viewerDepartmentId={viewerDepartmentId}
                depth={depth + 1}
              />
            ))}
          </div>
        </>
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

/** عضوٌ في قسمه: شريحةٌ بصورته أو حرفه الأول، واسمه، ومسمّاه في التلميح.
 *
 *  من لا صورة له يُرسم بحرفه الأول على لون قسمه — لا أيقونةٌ عامة تُساوي
 *  بين الناس. */
function MemberChip({ person, color, highlight }: { person: OrgPerson; color: string; highlight: boolean }) {
  const light = needsOutline(color);
  return (
    <span
      title={person.title}
      className={`inline-flex items-center gap-2 rounded-full bg-white py-1 pe-3 ps-1 text-[12.5px] font-bold text-black/80 ${
        highlight ? "ring-2 ring-[#C34900]" : "ring-1 ring-black/10"
      }`}
    >
      {person.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatarUrl} alt="" loading="lazy" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
          style={{ background: light ? "#DDE7CB" : color, color: light ? "#341D2B" : readableTextOn(color) }}
        >
          {person.fullName.trim().charAt(0)}
        </span>
      )}
      <span className="flex flex-col leading-tight">
        <span>{person.fullName}</span>
        <span className="text-[10px] font-medium text-black/45">{person.title}</span>
      </span>
      {highlight && <span className="rounded-full bg-[#C34900] px-1.5 text-[9px] text-white">أنت</span>}
    </span>
  );
}
