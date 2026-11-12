import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** **معاينةُ هوية 2026 خارج المنصة** — لا صفحةَ في المنصة ولا نشر: ملفاتُ HTML في مجلّدٍ محليّ تُصوَّر وتُعرض على
 *  المؤسس في المحادثة قبل الاعتماد (قراره: «لا تحطه لي بالمنصه … وشاركني هنا التفاصيل قبل الاعتماد»).
 *
 *    npx tsx --tsconfig tsconfig.json scripts/brand-preview.ts <مجلّد الإخراج>
 *
 *  البريد يُبنى بدوالّه الحقيقية وبمتغيّراتٍ تجريبية (لا بيانات أعضاء) عبر وضع الالتقاط (`emailCapture`) — فلا
 *  يُرسَل شيءٌ ولا يُسجَّل — ثم يُرسم بالقالب الحالي والجديد. يحتاج قاعدةً محلية (لقراءة جنس المستلم إن وُجد). */

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("يُشغَّل على قاعدةٍ محلية وحدها");
  process.exit(1);
}
if (process.env.VERCEL || process.env.RESEND_API_KEY) {
  console.error("محلياً فقط والبريد معطّل");
  process.exit(1);
}

const OUT = resolve(process.argv[2] ?? "brand-preview-out");
const KIT = pathToFileURL(resolve(process.cwd(), "brand-assets/2026")).href;
const D = new Date("2026-11-20T09:00:00+03:00");
const P = { to: "preview@example.test", fullName: "سارة أحمد", url: "https://tlaqiteam.site/" };

(async () => {
  const E = await import("@/lib/email");
  const { captureEmails } = await import("@/lib/emailCapture");
  const { renderEmail } = await import("@/lib/emailBrand");
  const { renderEmail2026 } = await import("@/lib/brand2026/email");
  const T = await import("@/lib/brand2026/tokens");

  const emails: [string, string, () => Promise<unknown>][] = [
    ["invitation", "دعوة الانضمام (بيانات الدخول)", () => E.sendCredentialsEmail({ ...P, tempPassword: "Tq-Preview-0000", loginUrl: P.url + "login", occasion: "invitation", departmentName: "التسويق", jobTitle: "صانعة محتوى", invitedByName: "الإدارة", hoursValid: 72 })],
    ["login-code", "رمز الدخول (التحقق)", () => E.sendLoginCodeEmail({ ...P, code: "482913", minutesValid: 10 })],
    ["password-reset", "استعادة كلمة المرور", () => E.sendPasswordResetEmail({ ...P, resetUrl: P.url + "reset-password/preview", minutesValid: 30 })],
    ["decision", "قرار طلب (قبول)", () => E.sendApprovalDecisionEmail({ to: P.to, ticketNumber: 1042, subject: "طلب شهادة إنجاز", stateLabel: "اعتُمد", note: "اعتُمد الطلب وتُصدر الشهادة خلال يومين.", byName: "قائدة القسم", url: P.url })],
    ["apology", "اعتذار (لم يجتز التقييم)", () => E.sendTestFailedEmail({ ...P, score: 54, departmentName: "التقنية", dueDate: D })],
    ["reminder", "تذكير بموعد", () => E.sendTicketReminderEmail({ to: P.to, subject: "تسليم خطة الحملة", memberName: P.fullName, stageLabel: "بانتظار التنفيذ", dueDate: D, fromName: "المنصة", portalUrl: P.url })],
    ["internal-alert", "تنبيه إداري (تذكرة جديدة)", () => E.sendTicketCreatedEmail({ to: P.to, subject: "طلب صلاحية لأداة التصميم", description: "أحتاج صلاحية لملفات الهوية لتجهيز منشورات الحملة.", memberName: P.fullName, dueDate: D, portalUrl: P.url })],
    ["committee-lead", "تعيين قائد لجنة", () => E.sendCommitteeLeadAppointedEmail({ ...P, committeeName: "لجنة المحتوى الرقمي", parentName: "التسويق", appointedByName: "قائد القسم", url: P.url, appointedAt: D })],
    ["committee-member", "الانضمام إلى لجنة", () => E.sendCommitteeMemberAddedEmail({ ...P, committeeName: "لجنة المحتوى الرقمي" })],
    ["senior-invitation", "دعوة الإدارة العليا", () => E.sendSeniorInvitationEmail({ to: P.to, fullName: P.fullName, titleAr: "المستشار القانوني", inviterName: "الرئيس التنفيذي", acceptUrl: P.url + "senior/invite/preview", expiresAt: D })],
    ["agreement-request", "طلب توقيع اتفاقية", () => E.sendAgreementRequestEmail({ to: P.to, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", signUrl: P.url + "agreements/marketing" })],
    ["agreement-otp", "رمز توقيع الاتفاقية", () => E.sendAgreementOtpEmail({ to: P.to, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", code: "730154", minutesValid: 10 })],
    ["agreement-signed", "تأكيد التوقيع", () => E.sendAgreementSignedEmail({ to: P.to, fullName: P.fullName, agreementTitle: "اتفاقية السرية وحماية أصول التسويق", version: 1, signedAt: D, documentHash: "3f9a6c0d2b8e4f1a9c7d5e3b1a0f8e6d4c2b0a9e8d7c6b5a4f3e2d1c0b9ac21e", copyUrl: P.url + "agreements/signed/preview" })],
    ["certificate", "إصدار شهادة", () => E.sendIssuedCertificateEmail({ ...P, heading: "شهادة إنجاز", sentence: "تشهد تلاق بإتمام سارة أحمد مهامّها في حملة الإطلاق بكفاءة.", number: "TLQ-2026-0042", departmentName: "التسويق", certificateUrl: P.url + "certificate/preview" })],
  ];

  mkdirSync(join(OUT, "emails"), { recursive: true });
  const index: string[] = [];
  for (const [key, title, fn] of emails) {
    const [m] = await captureEmails(fn);
    if (!m) throw new Error(`لم تُلتقط رسالة: ${key}`);
    const next = renderEmail2026({ subject: m.subject, content: m.content, theme: m.theme, assetBase: KIT, fontFaceBase: `${KIT}/fonts` });
    const current = renderEmail({ subject: m.subject, content: m.content, theme: m.theme, preheader: m.subject }).html;
    writeFileSync(join(OUT, "emails", `${key}.new.html`), next);
    writeFileSync(join(OUT, "emails", `${key}.current.html`), current);
    index.push(`${key}\t${title}\t${m.subject}`);
  }
  writeFileSync(join(OUT, "emails", "index.tsv"), index.join("\n"));

  // ── لوحةُ الهوية والمكوّنات والمستندات (HTML ثابت بالرموز نفسها)
  const H = T.HEX;
  const BG = T.BACKGROUNDS;
  const A = (p: string) => `${KIT}/${p}`;
  const font = T.TYPEFACE.weights.map((w) => `@font-face{font-family:"${T.TYPEFACE.family}";src:url("${A(`fonts/${w.file}`)}") format("opentype");font-weight:${w.weight}}`).join("");
  const pattern = (name: string, color: string, size: "M" | "L", h: number, bg: string) =>
    `<div style="height:${h}px;background:${bg} url('${A(`patterns/pattern-${name}_${size}_${color}.svg`)}') repeat;background-size:${size === "L" ? 96 : 48}px"></div>`;
  const card = (inner: string, pad = 18) => `<div style="background:${BG.surface};border:1px solid ${H.temptress};border-radius:16px;padding:${pad}px">${inner}</div>`;
  const btn = (label: string, kind: "primary" | "accent" | "outline" | "disabled") =>
    `<button style="min-height:44px;padding:0 18px;border-radius:12px;font:700 14px var(--f);${
      kind === "primary" ? `background:${H.temptress};color:${H.beige};border:1.5px solid ${H.temptress}` : kind === "accent" ? `background:${H.greenSheen};color:${H.temptress};border:1.5px solid ${H.greenSheen}` : kind === "outline" ? `background:${BG.surface};color:${H.temptress};border:1.5px solid ${H.temptress}` : `background:${BG.surface};color:${H.temptress};border:1.5px dashed ${H.temptress}`
    }">${label}</button>`;
  const alert = (k: keyof typeof T.STATES, text: string) => {
    const s = T.STATES[k];
    return `<div style="display:flex;gap:10px;align-items:center;background:${s.bg};color:${s.ink};border:2px ${s.borderStyle} ${s.border};border-radius:12px;padding:10px 12px;font-size:14px"><img src="${A(`icons/${s.icon}.svg`)}" width="20" height="20" alt=""><span><b>${s.label}:</b> ${text}</span></div>`;
  };
  const chip = (label: string, style: string) => `<span style="display:inline-block;padding:3px 12px;border-radius:999px;font-size:12px;font-weight:700;color:${H.temptress};${style}">${label}</span>`;
  const chips = [
    chip("مسودة", `border:1px solid ${H.temptress}`),
    chip("بانتظار الاعتماد", `border:1.5px dashed ${H.mahogany}`),
    chip("معتمد", `background:${H.greenSheen}`),
    chip("يحتاج تعديلاً", `border:1.5px solid ${H.mahogany}`),
    chip("منشور", `background:${H.temptress};color:${H.beige}`),
    chip("مؤرشف", `border:1px dashed ${H.temptress}`),
  ].join(" ");
  const section = (id: string, title: string, inner: string) => `<section id="${id}" style="margin:0 0 28px"><h2 style="margin:0 0 12px;font-size:22px;font-weight:800;color:${H.mahogany}">${title}</h2>${inner}</section>`;

  const showcase = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>هوية تلاق 2026 — معاينة</title>
<style>${font}:root{--f:"${T.TYPEFACE.family}",${T.TYPEFACE.fallback}}*{box-sizing:border-box}body{margin:0;background:${BG.platformPage};color:${H.temptress};font-family:var(--f)}main{max-width:1180px;margin:0 auto;padding:28px 20px}.g{display:grid;gap:12px}.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.g4{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}input{min-height:44px;width:100%;border-radius:12px;border:1px solid ${H.temptress};background:${BG.surface};color:${H.temptress};padding:0 12px;font:14px var(--f)}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:10px;text-align:start}</style></head><body><main>
<header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px"><img src="${A("logos/full/TLAQI-logo-full_on-beige.svg")}" alt="TLAQI" style="width:240px"><span style="font-size:13px">${T.BRAND_VERSION.label} · معاينة قبل الاعتماد</span></header>
${section("logo", "الشعار", `<div class="g g4">${T.LOGOS.full.filter((l) => !l.derived).map((l) => `<div><div style="background:${l.bg === "beige" ? BG.surface : H[l.bg as keyof typeof H]};border:1px solid ${H.temptress};border-radius:14px;padding:26px 20px;display:grid;place-items:center"><img src="${A(`logos/full/${l.file}.svg`)}" alt="" style="width:100%;max-width:230px"></div><p style="font-size:12px;margin:6px 0 0">${l.bg === "beige" ? "على الأبيض (النسخة الملوّنة)" : `على ${T.COLORS[l.bg as keyof typeof T.COLORS].name}`}</p></div>`).join("")}<div><div style="background:${BG.surface};border:1px solid ${H.temptress};border-radius:14px;padding:20px;display:grid;place-items:center"><img src="${A("logos/mark/TLAQI-mark_mahogany.svg")}" alt="" style="width:70px"></div><p style="font-size:12px;margin:6px 0 0">العلامة وحدها — للمساحات الصغيرة</p></div></div>`)}
${section("colors", "الألوان الأربعة (والخلفيات بيضاء كما هي)", `<div class="g g4">${(Object.keys(T.COLORS) as (keyof typeof T.COLORS)[]).map((k) => `<div style="background:${H[k]};color:${k === "beige" || k === "greenSheen" ? H.temptress : H.beige};border:1px solid ${H.temptress};border-radius:14px;padding:16px;min-height:104px"><b style="font-size:18px">${T.COLORS[k].name}</b><div style="font-size:13px">${T.COLORS[k].roleAr}</div><div dir="ltr" style="font-size:13px;text-align:right;margin-top:6px">${T.COLORS[k].hex}</div></div>`).join("")}<div style="background:${BG.surface};border:1px dashed ${H.temptress};border-radius:14px;padding:16px;min-height:104px"><b style="font-size:18px">الخلفيات</b><div style="font-size:13px">بيضاء كما هي اليوم — قرار المؤسس</div><div dir="ltr" style="font-size:13px;text-align:right;margin-top:6px">#FFFFFF · ${BG.platformPage}</div></div></div>`)}
${section("type", "الخط: The Year of The Camel", card(T.TYPEFACE.weights.map((w) => `<div style="padding:6px 0;border-bottom:1px solid ${H.temptress}"><span style="font-size:12px">${w.weight} · ${w.name}</span><div style="font-weight:${w.weight};font-size:28px">تلاق — منصة الموهبة والربط · Talent Link 2026</div></div>`).join("") + `<p style="font-size:15px;line-height:2;margin:10px 0 0">نصُّ فقرةٍ عادي بحجم 15 لقراءة المتون والجداول والنماذج.</p>`))}
${section("patterns", "الأنماط (في أشرطة مستقلة — لا خلف نص)", `<div class="g g2">${T.PATTERNS.map((p) => `<div>${pattern(p.key, "mahogany", "M", 70, BG.surface).replace("<div", `<div style="border:1px solid ${H.temptress};border-radius:12px;overflow:hidden"><div`)}</div><p style="font-size:13px;margin:6px 0 0"><b>${p.ar}</b> · ${p.meaningAr}</p></div>`).join("")}<div>${pattern("talent", "beige", "L", 70, H.temptress)}<p style="font-size:13px;margin:6px 0 0"><b>موهبة على الداكن</b> · مقاس L للأغلفة</p></div></div>`)}
${section("components", "الأزرار والنماذج والحالات", `<div class="g g2">${card(`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${btn("حفظ", "primary")}${btn("إرسال", "accent")}${btn("إلغاء", "outline")}${btn("غير متاح", "disabled")}</div><label style="display:grid;gap:6px;font-size:14px"><b>البريد الإلكتروني</b><input value="sara@" dir="ltr" style="border:2px solid ${H.mahogany}"><span style="font-size:13px"><b style="color:${H.mahogany}">!</b> البريد غير مكتمل — اكتب العنوان كاملاً</span></label>`)}${card(`<div class="g">${alert("success", "حُفظت التعديلات.")}${alert("error", "تعذّر الحفظ — تحقّق من الحقول.")}${alert("warning", "تنتهي مهلة الدعوة غداً.")}${alert("info", "يُرسل رابطٌ صالحٌ سبعة أيام.")}</div>`)}</div>`)}
${section("surfaces", "البطاقات والجداول والشارات", card(`<div style="margin-bottom:12px">${chips}</div><div class="g g2" style="margin-bottom:14px">${["لجنة المحتوى الرقمي|التسويق · 6 أعضاء|talent", "لجنة البنية التقنية|التقنية · 4 أعضاء|innovation"].map((x) => { const [t, d, p] = x.split("|"); return `<div style="border:1px solid ${H.temptress};border-radius:16px;overflow:hidden">${pattern(p, "mahogany", "M", 40, BG.surface)}<div style="border-top:1px solid ${H.temptress};padding:14px"><b style="font-size:16px">${t}</b><div style="font-size:13px">${d}</div></div></div>`; }).join("")}</div><table style="border:1px solid ${H.temptress}"><thead><tr style="background:${H.temptress};color:${H.beige}"><th>الاسم</th><th>القسم</th><th>الحالة</th></tr></thead><tbody>${[["سارة أحمد", "التسويق", chip("معتمد", `background:${H.greenSheen}`)], ["خالد علي", "التقنية", chip("بانتظار الاعتماد", `border:1.5px dashed ${H.mahogany}`)]].map((r) => `<tr style="border-top:1px solid ${H.temptress}"><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table>`))}
${section("navigation", "القائمة الجانبية والترويسة", `<div style="display:grid;grid-template-columns:240px 1fr;border:1px solid ${H.temptress};border-radius:16px;overflow:hidden;min-height:300px"><aside style="background:${BG.surface};border-inline-end:1px solid ${H.temptress};padding:14px;display:grid;align-content:start;gap:4px"><img src="${A("logos/full/TLAQI-logo-full_on-beige.svg")}" alt="" style="width:170px;margin:4px 0 14px">${["نظرة عامة", "التذاكر", "الأقسام واللجان", "الإدارة العليا", "سجل الحوكمة"].map((x, i) => `<div style="padding:9px 12px;border-radius:10px;font-size:14px;${i === 0 ? `background:${H.temptress};color:${H.beige};font-weight:800` : ""}">${x}</div>`).join("")}</aside><div style="background:${BG.platformPage}"><div style="background:${BG.surface};border-bottom:1px solid ${H.temptress};padding:12px 18px;display:flex;justify-content:space-between"><b style="font-size:18px;color:${H.mahogany}">الأقسام واللجان</b><span style="font-size:13px">سارة أحمد · قائدة قسم</span></div><div style="padding:18px;font-size:14px;line-height:1.9">الخلفية بيضاء كما هي؛ والنصُّ Temptress، والعناوينُ الكبيرة Mahogany، والعنصرُ النشط Temptress بنص Beige.</div></div></div>`)}
${section("documents", "المستندات: الشهادة وغلاف التقرير", `<div class="g g2"><div style="background:${BG.surface};border:2px solid ${H.temptress};border-radius:18px;overflow:hidden"><div style="background:${H.temptress};padding:16px 22px;display:flex;justify-content:space-between;align-items:center"><img src="${A("logos/full/TLAQI-logo-full_on-temptress.svg")}" alt="" style="width:180px"><span dir="ltr" style="color:${H.beige};font-size:12px">TLQ-2026-0042</span></div><div style="padding:24px;text-align:center"><div style="font-size:12px;letter-spacing:1px">CERTIFICATE OF ACHIEVEMENT</div><div style="font-size:34px;font-weight:800;color:${H.mahogany}">شهادة إنجاز</div><div style="font-size:24px;font-weight:800;margin-top:10px">سارة أحمد</div><p style="font-size:14px;line-height:2">تشهد تلاق بإتمامها مهامّها في حملة الإطلاق بكفاءةٍ والتزام.</p></div>${pattern("talent", "mahogany", "M", 40, BG.surface).replace("<div", `<div style="border-top:1px solid ${H.temptress}"><div`)}</div></div><div style="border:1px solid ${H.temptress};border-radius:16px;overflow:hidden"><div style="background:${H.temptress};color:${H.beige};padding:24px"><img src="${A("logos/full/TLAQI-logo-full_on-temptress.svg")}" alt="" style="width:170px"><div style="font-size:28px;font-weight:800;margin-top:18px">تقرير لجنة المحتوى الرقمي</div><div style="font-size:14px">الربع الرابع 2026 · المحضر والقرارات</div></div>${pattern("talent", "beige", "L", 96, H.temptress)}<div style="background:${BG.surface};padding:18px;font-size:14px;line-height:1.9"><b style="color:${H.mahogany};font-size:18px">الملخّص</b><p style="margin:6px 0 0">صفحةُ المتن بيضاء بنص Temptress — والنمطُ في لوحةٍ مستقلة عن العنوان.</p></div></div></div>`)}
</main></body></html>`;
  writeFileSync(join(OUT, "showcase.html"), showcase);
  console.log(`emails: ${emails.length} → ${join(OUT, "emails")}\nshowcase → ${join(OUT, "showcase.html")}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
