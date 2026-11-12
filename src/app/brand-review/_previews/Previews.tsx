import type { CSSProperties, ReactNode } from "react";
import { HEX, COLORS, CONTRAST_PAIRS, measuredContrast, TYPEFACE, LOGOS, PATTERNS, ICONS, LETTER_MARKS, STATES, previewCssVars, type BrandColor } from "@/lib/brand2026/tokens";

/** **معاينات هوية 2026** — تُرسم داخل حاويةٍ معزولة بمتغيّراتها (`--b26-*`) وخطّها من المسار المحميّ، فلا تمسّ
 *  بقية المنصة. كلُّ لونٍ هنا من الألوان الأربعة؛ ولا شفافية ولا رمادي. */

export const ASSET = "/brand-review/asset";
const A = (p: string) => `${ASSET}/${p}`;
const B = HEX;

export function FontFaces() {
  const css = TYPEFACE.weights
    .map((w) => `@font-face{font-family:"${TYPEFACE.family}";src:url("${A(`fonts/${w.file}`)}") format("opentype");font-weight:${w.weight};font-style:normal;font-display:swap}`)
    .join("\n");
  return <style>{css}</style>;
}

function Frame({ mode = "light", children, style }: { mode?: "light" | "dark"; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      dir="rtl"
      style={{
        ...(previewCssVars(mode) as CSSProperties),
        background: "var(--b26-page)",
        color: "var(--b26-ink)",
        fontFamily: "var(--b26-font)",
        border: `1px solid ${B.temptress}`,
        borderRadius: 16,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: "10px 0 6px", fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>{children}</p>
);

const Pattern = ({ name, color, size = "M", height = 56, bg }: { name: string; color: string; size?: "M" | "L"; height?: number; bg: string }) => (
  <div
    aria-hidden
    style={{
      height,
      background: `${bg} url("${A(`patterns/pattern-${name}_${size}_${color}.svg`)}") repeat`,
      backgroundSize: size === "L" ? "96px 96px" : "48px 48px",
      borderRadius: 12,
    }}
  />
);

// ═════════════════════ عناصر الهوية ═════════════════════

function LogoPreview() {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {LOGOS.full.map((l) => (
          <figure key={l.file} style={{ margin: 0 }}>
            <div style={{ background: B[l.bg as BrandColor], border: `1px solid ${B.temptress}`, borderRadius: 14, padding: "28px 24px", display: "grid", placeItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={A(`logos/full/${l.file}.svg`)} alt={`TLAQI — ${l.noteAr}`} style={{ width: "100%", maxWidth: 260, height: "auto" }} />
            </div>
            <figcaption style={{ fontSize: 12, marginTop: 6 }}>
              على {COLORS[l.bg as BrandColor].name} — {l.noteAr} {l.derived && <b>(بانتظار قرار ق5)</b>}
            </figcaption>
          </figure>
        ))}
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {LOGOS.mark.map((m) => (
          <figure key={m.file} style={{ margin: 0 }}>
            <div style={{ background: B[m.bg as BrandColor], border: `1px solid ${B.temptress}`, borderRadius: 14, padding: 20, display: "grid", placeItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={A(`logos/mark/${m.file}.svg`)} alt="علامة TLAQI" style={{ width: 72, height: "auto" }} />
            </div>
            <figcaption style={{ fontSize: 12, marginTop: 6 }}>{m.noteAr}</figcaption>
          </figure>
        ))}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.9, margin: 0 }}>
        <b>قواعد:</b> الملفاتُ كما هي — لا تلوين ولا قصّ ولا تمديد. الشعار الكامل لا يقل عن 70 مم طباعةً؛ ومقترحُ الحدّ الرقمي {LOGOS.minFullWidthPx} بكسل
        عرضاً (ق4)، وإلا العلامة وحدها. ومساحةُ الأمان غير محددة في الهوية — المقترح: ارتفاعُ حرف «T» من كل جهة (ق4).
      </p>
    </div>
  );
}

function ColorsPreview() {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        {(Object.keys(COLORS) as BrandColor[]).map((k) => (
          <div key={k} style={{ background: B[k], color: k === "beige" || k === "greenSheen" ? B.temptress : B.beige, border: `1px solid ${B.temptress}`, borderRadius: 14, padding: 16, minHeight: 110 }}>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>{COLORS[k].name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>{COLORS[k].roleAr}</p>
            <p dir="ltr" style={{ margin: "8px 0 0", fontSize: 13, textAlign: "right" }}>{COLORS[k].hex}</p>
          </div>
        ))}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: B.temptress, color: B.beige }}>
            <th style={{ padding: 8, textAlign: "start" }}>الزوج</th>
            <th style={{ padding: 8 }}>عيّنة</th>
            <th style={{ padding: 8 }}>ملف الهوية</th>
            <th style={{ padding: 8 }}>المحسوب هنا</th>
            <th style={{ padding: 8, textAlign: "start" }}>الاستخدام</th>
          </tr>
        </thead>
        <tbody>
          {CONTRAST_PAIRS.map((p) => (
            <tr key={`${p.fg}-${p.bg}`} style={{ borderBottom: `1px solid ${B.temptress}` }}>
              <td style={{ padding: 8 }}>{COLORS[p.fg].name} / {COLORS[p.bg].name}</td>
              <td style={{ padding: 8, textAlign: "center" }}>
                <span style={{ background: B[p.bg], color: B[p.fg], padding: "4px 10px", borderRadius: 8, border: `1px solid ${B.temptress}`, fontWeight: 700 }}>تلاق Aa</span>
              </td>
              <td style={{ padding: 8, textAlign: "center" }}>{p.kit ? `${p.kit}:1` : "—"}</td>
              <td style={{ padding: 8, textAlign: "center" }}>{measuredContrast(p.fg, p.bg)}:1</td>
              <td style={{ padding: 8 }}>{p.use}{p.text ? "" : " ⛔ نص"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 13, margin: 0 }}>أربعة ألوان فقط — لا أزرق، ولا شفافية تصنع لوناً خامساً.</p>
    </div>
  );
}

function TypographyPreview() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {TYPEFACE.weights.map((w) => (
        <div key={w.weight} style={{ borderBottom: `1px solid ${B.temptress}`, paddingBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 12 }}>{w.weight} · {w.name}</p>
          <p style={{ margin: "4px 0 0", fontWeight: w.weight, fontSize: 30, lineHeight: 1.5 }}>تلاق — منصة الموهبة والربط</p>
          <p dir="ltr" style={{ margin: 0, fontWeight: w.weight, fontSize: 22, textAlign: "right" }}>Talent Link Advancing Quality Innovation · 0123456789</p>
        </div>
      ))}
      <p style={{ fontSize: 15, lineHeight: 2, margin: 0 }}>
        نصُّ فقرةٍ عادي بحجم 15: تُعرض هنا قراءةُ الخط في المتون الطويلة والجداول والنماذج، بالأرقام الغربية 2026 كما في نماذج الهوية.
      </p>
      <p style={{ fontSize: 12, margin: 0, border: `1px dashed ${B.mahogany}`, borderRadius: 10, padding: 10 }}>
        ⚠ ق1: ملفاتُ الخط بلا نص رخصة — يُعرض الخط هنا من مسارٍ محميّ لفريق المنصة وحده، ولا يُضمَّن في المنصة العامة أو البريد قبل تأكيد الرخصة.
      </p>
    </div>
  );
}

function PatternsPreview() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {PATTERNS.map((p) => (
        <div key={p.key} style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 18, color: B.mahogany }}>
            {p.ar} <span dir="ltr" style={{ fontSize: 12, color: B.temptress }}>{p.en}</span> {p.primary && <span style={{ fontSize: 12, color: B.temptress }}>· النمط الأساسي</span>}
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>{p.meaningAr}</p>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div><Label>على الفاتح · L</Label><Pattern name={p.key} color="mahogany" size="L" height={110} bg={B.beige} /></div>
            <div><Label>على الفاتح · M</Label><Pattern name={p.key} color="mahogany" height={110} bg={B.beige} /></div>
            <div><Label>على الداكن · L</Label><Pattern name={p.key} color="beige" size="L" height={110} bg={B.temptress} /></div>
          </div>
        </div>
      ))}
      <p style={{ fontSize: 13, margin: 0 }}>لا نمط خلف نص؛ مقاسٌ ثابت (L للأغلفة واللوحات، M للبطاقات)؛ لا تدوير ولا تمديد.</p>
    </div>
  );
}

function IconsPreview() {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))" }}>
      {ICONS.map((i) => (
        <div key={i} style={{ border: `1px solid ${B.temptress}`, borderRadius: 12, padding: 10, display: "grid", placeItems: "center", gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={A(`icons/${i}.svg`)} alt="" width={28} height={28} />
          <span dir="ltr" style={{ fontSize: 10 }}>{i}</span>
        </div>
      ))}
    </div>
  );
}

function LettersPreview() {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))" }}>
      {LETTER_MARKS.map((l) => (
        <div key={l.letter} style={{ border: `1px solid ${B.temptress}`, borderRadius: 14, padding: 14, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 56, fontWeight: 800, lineHeight: 1.2 }}>{l.letter}</p>
          <p dir="ltr" style={{ margin: 0, fontSize: 11, letterSpacing: 1 }}>{l.en}</p>
          <p style={{ margin: "4px 0 0", fontWeight: 700 }}>{l.ar}</p>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════ مكوّنات الواجهة ═════════════════════

const btn = (kind: "primary" | "accent" | "outline" | "disabled"): CSSProperties => ({
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 12,
  fontFamily: "inherit",
  fontWeight: 700,
  fontSize: 14,
  cursor: kind === "disabled" ? "not-allowed" : "pointer",
  background: kind === "primary" ? "var(--b26-primary)" : kind === "accent" ? "var(--b26-accent)" : "transparent",
  color: kind === "primary" ? "var(--b26-on-primary)" : kind === "accent" ? "var(--b26-on-accent)" : "var(--b26-ink)",
  border: kind === "outline" ? "1.5px solid var(--b26-border)" : kind === "disabled" ? "1.5px dashed var(--b26-border)" : "1.5px solid transparent",
});
const input: CSSProperties = { minHeight: 44, width: "100%", borderRadius: 12, border: "1px solid var(--b26-border)", background: "var(--b26-surface)", color: "var(--b26-ink)", padding: "0 12px", fontFamily: "inherit", fontSize: 14 };

function ActionsSet() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" style={btn("primary")}>حفظ واعتماد</button>
        <button type="button" style={btn("accent")}>إرسال للمراجعة</button>
        <button type="button" style={btn("outline")}>إلغاء</button>
        <button type="button" disabled style={btn("disabled")}>غير متاح الآن</button>
      </div>
      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>الاسم الكامل</span>
        <input style={input} defaultValue="سارة أحمد" />
      </label>
      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        <span style={{ fontWeight: 700 }}>البريد الإلكتروني</span>
        <input style={{ ...input, border: `2px solid ${B.mahogany}` }} defaultValue="sara@" dir="ltr" aria-invalid />
        <span style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <span aria-hidden style={{ color: B.mahogany, fontWeight: 800 }}>!</span> البريد غير مكتمل — اكتب العنوان كاملاً
        </span>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" defaultChecked style={{ width: 18, height: 18, accentColor: "var(--b26-primary)" }} /> قرأتُ النص كاملاً
      </label>
    </div>
  );
}

function ActionsPreview() {
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
      <Frame><Label>الوضع الفاتح</Label><ActionsSet /></Frame>
      <Frame mode="dark"><Label>الوضع الداكن</Label><ActionsSet /></Frame>
    </div>
  );
}

const STATUS_STYLE: { label: string; style: CSSProperties }[] = [
  { label: "مسودة", style: { border: `1px solid ${B.temptress}` } },
  { label: "بانتظار الاعتماد", style: { border: `1.5px dashed ${B.mahogany}` } },
  { label: "معتمد", style: { background: B.greenSheen } },
  { label: "يحتاج إلى تعديلات", style: { border: `1.5px solid ${B.mahogany}` } },
  { label: "منشور", style: { background: B.temptress, color: B.beige } },
  { label: "مؤرشف", style: { border: `1px dashed ${B.temptress}` } },
];

function SurfacesPreview() {
  return (
    <Frame>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {STATUS_STYLE.map((s) => (
          <span key={s.label} style={{ padding: "3px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: B.temptress, ...s.style }}>{s.label}</span>
        ))}
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginBottom: 14 }}>
        {[
          { t: "لجنة المحتوى الرقمي", d: "التسويق · 6 أعضاء", c: "mahogany", p: "talent" },
          { t: "لجنة البنية التقنية", d: "التقنية · 4 أعضاء", c: "mahogany", p: "innovation" },
        ].map((c) => (
          <div key={c.t} style={{ border: `1px solid ${B.temptress}`, borderRadius: 16, overflow: "hidden" }}>
            <Pattern name={c.p} color={c.c} height={40} bg={B.beige} />
            <div style={{ borderTop: `1px solid ${B.temptress}`, padding: 14 }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 16 }}>{c.t}</p>
              <p style={{ margin: "4px 0 0", fontSize: 13 }}>{c.d}</p>
            </div>
          </div>
        ))}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: `1px solid ${B.temptress}` }}>
        <thead>
          <tr style={{ background: B.temptress, color: B.beige }}>
            <th style={{ padding: 10, textAlign: "start" }}>الاسم</th>
            <th style={{ padding: 10, textAlign: "start" }}>القسم</th>
            <th style={{ padding: 10, textAlign: "start" }}>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {[["سارة أحمد", "التسويق", "معتمد"], ["خالد علي", "التقنية", "بانتظار الاعتماد"], ["نورة سعد", "الموارد البشرية", "مسودة"]].map((r) => (
            <tr key={r[0]} style={{ borderTop: `1px solid ${B.temptress}` }}>
              <td style={{ padding: 10, fontWeight: 700 }}>{r[0]}</td>
              <td style={{ padding: 10 }}>{r[1]}</td>
              <td style={{ padding: 10 }}>
                <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...STATUS_STYLE.find((s) => s.label === r[2])!.style }}>{r[2]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, margin: "10px 0 0" }}>ق3: ألوانُ الأقسام من الأربعة مع نمطٍ لكل قسم — لا ألوان جديدة.</p>
    </Frame>
  );
}

function Alert({ kind, text }: { kind: keyof typeof STATES; text: string }) {
  const s = STATES[kind];
  return (
    <div role="status" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: s.bg, color: s.ink, border: `2px ${s.borderStyle} ${s.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 14 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={A(`icons/${s.icon}.svg`)} alt="" width={20} height={20} />
      <span><b>{s.label}:</b> {text}</span>
    </div>
  );
}

function StatesPreview() {
  return (
    <Frame>
      <div style={{ display: "grid", gap: 10 }}>
        <Alert kind="success" text="حُفظت التعديلات." />
        <Alert kind="error" text="تعذّر الحفظ — تحقّق من الحقول المعلَّمة." />
        <Alert kind="warning" text="تنتهي مهلة الدعوة غداً." />
        <Alert kind="info" text="تُرسل الدعوة برابطٍ صالحٍ سبعة أيام." />
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginTop: 14 }}>
        <div style={{ border: `1px solid ${B.temptress}`, borderRadius: 14, padding: 16, display: "grid", placeItems: "center", gap: 8 }}>
          <div aria-label="جارٍ التحميل" style={{ width: 34, height: 34, borderRadius: "50%", border: `4px solid ${B.greenSheen}`, borderTopColor: B.temptress }} />
          <span style={{ fontSize: 13 }}>جارٍ التحميل…</span>
        </div>
        <div style={{ border: `1px solid ${B.temptress}`, borderRadius: 14, overflow: "hidden" }}>
          <Pattern name="link" color="mahogany" height={44} bg={B.beige} />
          <div style={{ borderTop: `1px solid ${B.temptress}`, padding: 14, textAlign: "center", fontSize: 13 }}>
            <b style={{ fontSize: 15 }}>لا لجان بعد</b>
            <p style={{ margin: "4px 0 0" }}>أنشئ أول لجنة لقسمك.</p>
          </div>
        </div>
        <div style={{ border: `1px solid ${B.temptress}`, borderRadius: 14, padding: 16 }}>
          <p style={{ margin: 0, fontWeight: 800, color: B.mahogany, fontSize: 18 }}>تأكيد الأرشفة</p>
          <p style={{ margin: "6px 0 12px", fontSize: 13 }}>تُحفظ اللجنةُ بسجلّها، وتُسترجع متى شئت.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn("primary")}>أرشفة</button>
            <button type="button" style={btn("outline")}>تراجع</button>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
        <div role="status" style={{ background: B.temptress, color: B.beige, borderRadius: 12, padding: "10px 14px", fontSize: 13 }}>✓ أُرسلت الدعوة</div>
        <span style={{ position: "relative", display: "inline-block" }}>
          <span style={{ borderBottom: `1px dashed ${B.temptress}`, fontSize: 13 }}>تلميح</span>
          <span role="tooltip" style={{ marginInlineStart: 8, background: B.temptress, color: B.beige, borderRadius: 8, padding: "4px 8px", fontSize: 12 }}>يظهر عند المرور والتركيز</span>
        </span>
      </div>
    </Frame>
  );
}

function NavItem({ active, children }: { active?: boolean; children: ReactNode }) {
  return (
    <div style={{ padding: "9px 12px", borderRadius: 10, fontSize: 14, fontWeight: active ? 800 : 500, background: active ? B.greenSheen : "transparent", color: active ? B.temptress : B.beige }}>
      {children}
    </div>
  );
}

function NavigationPreview() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,240px) 1fr", border: `1px solid ${B.temptress}`, borderRadius: 16, overflow: "hidden", minHeight: 320, fontFamily: "var(--b26-font)", ...(previewCssVars("light") as CSSProperties) }} dir="rtl">
      <aside style={{ background: B.temptress, padding: 14, display: "grid", alignContent: "start", gap: 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A("logos/full/TLAQI-logo-full_on-temptress.svg")} alt="TLAQI" style={{ width: 170, height: "auto", margin: "4px 0 14px" }} />
        <NavItem active>نظرة عامة</NavItem>
        <NavItem>التذاكر</NavItem>
        <NavItem>الأقسام واللجان</NavItem>
        <NavItem>الإدارة العليا</NavItem>
        <NavItem>سجل الحوكمة</NavItem>
        <div style={{ marginTop: 14 }}><Pattern name="talent" color="beige" height={40} bg={B.temptress} /></div>
      </aside>
      <main style={{ background: B.beige, color: B.temptress }}>
        <header style={{ borderBottom: `1px solid ${B.temptress}`, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 18, color: B.mahogany }}>الأقسام واللجان</b>
          <span style={{ fontSize: 13 }}>سارة أحمد · قائدة قسم</span>
        </header>
        <div style={{ padding: 18, fontSize: 14, lineHeight: 1.9 }}>محتوى الصفحة على Beige بنص Temptress — والعناوينُ الكبيرة Mahogany.</div>
      </main>
    </div>
  );
}

// ═════════════════════ المستندات ═════════════════════

function CertificatePreview() {
  return (
    <div dir="rtl" style={{ background: B.beige, color: B.temptress, border: `2px solid ${B.temptress}`, borderRadius: 18, overflow: "hidden", fontFamily: "var(--b26-font)" }}>
      <div style={{ background: B.temptress, padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A("logos/full/TLAQI-logo-full_on-temptress.svg")} alt="TLAQI" style={{ width: 200, height: "auto" }} />
        <span dir="ltr" style={{ color: B.beige, fontSize: 12 }}>TLQ-2026-0042</span>
      </div>
      <div style={{ padding: "28px 28px 18px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 13, letterSpacing: 1 }}>CERTIFICATE OF ACHIEVEMENT</p>
        <p style={{ margin: "6px 0 0", fontSize: 36, fontWeight: 800, color: B.mahogany }}>شهادة إنجاز</p>
        <p style={{ margin: "14px 0 0", fontSize: 26, fontWeight: 800 }}>سارة أحمد</p>
        <p style={{ margin: "10px auto 0", maxWidth: 520, fontSize: 15, lineHeight: 2 }}>تشهد تلاق بإتمامها مهامّها في حملة الإطلاق بكفاءةٍ والتزام.</p>
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 26, fontSize: 13 }}>
          <div><div style={{ borderTop: `1px solid ${B.temptress}`, width: 160, margin: "0 auto 6px" }} />المؤسس</div>
          <div><div style={{ borderTop: `1px solid ${B.temptress}`, width: 160, margin: "0 auto 6px" }} />التاريخ: 2026-11-20</div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${B.temptress}` }}><Pattern name="talent" color="mahogany" height={44} bg={B.beige} /></div>
    </div>
  );
}

function AgreementPreview() {
  return (
    <div dir="rtl" style={{ background: B.beige, color: B.temptress, border: `1px solid ${B.temptress}`, borderRadius: 14, padding: 24, fontFamily: "var(--b26-font)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${B.temptress}`, paddingBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A("logos/full/TLAQI-logo-full_on-beige.svg")} alt="TLAQI" style={{ width: 180, height: "auto" }} />
        <span style={{ fontSize: 12 }}>نسخة موقّعة إلكترونياً · الإصدار 1</span>
      </div>
      <p style={{ margin: "16px 0 4px", fontSize: 22, fontWeight: 800, color: B.mahogany }}>اتفاقية السرية وحماية أصول التسويق</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, margin: "10px 0" }}>
        <tbody>
          {[["الموقِّع", "سارة أحمد"], ["الصفة", "عضو — التسويق"], ["وقت التوقيع", "2026-11-20 09:00 (الرياض)"], ["وسيلة الإثبات", "الاسم المكتوب + رمز البريد"]].map(([k, v]) => (
            <tr key={k} style={{ borderBottom: `1px solid ${B.temptress}` }}><td style={{ padding: 6, width: 140 }}>{k}</td><td style={{ padding: 6, fontWeight: 700 }}>{v}</td></tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 14, lineHeight: 2, margin: "8px 0" }}><b>البند 1 — الغرض</b><br />تنظّم هذه الاتفاقية اطّلاع المستلم على أصول التسويق والمعلومات السرية…</p>
      <div dir="ltr" style={{ border: `1px solid ${B.temptress}`, borderRadius: 10, padding: 10, fontFamily: "Consolas, monospace", fontSize: 11, wordBreak: "break-all" }}>
        Document SHA-256: 3f9a…c21e · Evidence: 81bd…07aa
      </div>
    </div>
  );
}

function ReportPreview() {
  return (
    <div dir="rtl" style={{ display: "grid", gridTemplateColumns: "1fr", border: `1px solid ${B.temptress}`, borderRadius: 16, overflow: "hidden", fontFamily: "var(--b26-font)" }}>
      <div style={{ background: B.temptress, color: B.beige, padding: "28px 26px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A("logos/full/TLAQI-logo-full_on-temptress.svg")} alt="TLAQI" style={{ width: 190, height: "auto" }} />
        <p style={{ margin: "22px 0 0", fontSize: 30, fontWeight: 800 }}>تقرير لجنة المحتوى الرقمي</p>
        <p style={{ margin: "6px 0 0", fontSize: 14 }}>الربع الرابع 2026 · محضر الاجتماعات والقرارات</p>
      </div>
      <Pattern name="talent" color="beige" size="L" height={96} bg={B.temptress} />
      <div style={{ background: B.beige, color: B.temptress, padding: 20, fontSize: 14, lineHeight: 1.9, borderTop: `1px solid ${B.beige}` }}>
        <b style={{ color: B.mahogany, fontSize: 18 }}>الملخّص</b>
        <p style={{ margin: "6px 0 0" }}>صفحةُ المتن على Beige بنص Temptress — والنمطُ في لوحةٍ مستقلة عن العنوان.</p>
      </div>
    </div>
  );
}

const MAP: Record<string, () => ReactNode> = {
  "identity.logo": LogoPreview,
  "identity.colors": ColorsPreview,
  "identity.typography": TypographyPreview,
  "identity.patterns": PatternsPreview,
  "identity.icons": IconsPreview,
  "identity.letters": LettersPreview,
  "component.actions": ActionsPreview,
  "component.surfaces": SurfacesPreview,
  "component.states": StatesPreview,
  "component.navigation": NavigationPreview,
  "document.certificate": CertificatePreview,
  "document.agreement": AgreementPreview,
  "document.report": ReportPreview,
};

export function ItemPreview({ itemKey }: { itemKey: string }) {
  const P = MAP[itemKey];
  if (!P) return null;
  return itemKey.startsWith("component.") ? <P /> : <Frame>{<P />}</Frame>;
}
