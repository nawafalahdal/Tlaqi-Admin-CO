import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { ensureFonts } from "@/lib/welcomeBanner";
import { defaultPortrait } from "@/lib/defaultPortraits";
import { HEX } from "@/lib/brand2026/tokens";
import { EMAIL_BRAND_ASSETS } from "@/lib/brand2026/emailAssets.generated";
import { pdfFromJpegs } from "@/lib/pdfFromJpegs";
import type { OrgGraph, OrgPersonView, OrgUnitView } from "@/lib/org/orgGraph";

/** **ملفُّ الهيكل للتنزيل** (طلب المؤسس، 18 نوفمبر 2026: «نسخة PDF بالموجود مع الصور والهيكلة والأقسام واللجان والأسماء»).
 *
 *  - **من الرسم البياني نفسِه** (`buildOrgGraph`) الذي تُبنى به صفحةُ الهيكل — شخصٌ واحدٌ = بطاقةٌ واحدة في موضعه الأساسي،
 *    واللجانُ تذكر أعضاءها بأسمائهم. فلا يختلف الملفُّ عمّا يُرى.
 *  - **بالموجود ولو ناقصاً:** إن لم يكتمل الهيكلُ (`readiness`) كُتب على الغلاف «نسخة عمل» بنواقصه — لا يُدَّعى أنها الرسمية.
 *  - **صفحاتٌ مرسومة** بـsharp (العربيةُ مشكَّلةٌ موصولة، كترويسة البريد) تُغلَّف PDF (`pdfFromJpegs`) — A4 عرضي.
 *  - الغلاف: القيادة (المؤسس، التنفيذي، المتابعة والتشغيل، الإدارة العليا ولجانها)، ثم لكل قسمٍ صفحتُه: قائدُه ونائبه، ولجانُه
 *    بقادتها وأعضائها، وأعضاؤه بصورهم وأرقامهم الوظيفية — وتنتقل إلى صفحةٍ تالية إن طالت. */

// A4 عرضي بدقّة 2x (842×595 نقطة)
const W = 1684;
const H = 1190;
const M = 56; // الهامش
const HEADER_H = 112;
const FOOTER_H = 56;
const FONT = "'The Year of The Camel', Cairo, 'Noto Sans Arabic', 'DejaVu Sans', sans-serif";
const LATIN = "Cairo, 'DejaVu Sans', sans-serif";
const C = { ink: HEX.temptress, accent: HEX.mahogany, beige: HEX.beige, muted: "#6B5A66", rule: "#E2DCD8", soft: "#F6F9EF" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** قصٌّ تقريبيٌّ بعرض الحرف — العربيةُ نحو نصف ارتفاع الخط */
const fit = (s: string, size: number, maxW: number) => {
  const max = Math.max(4, Math.floor(maxW / (size * 0.52)));
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};
const text = (x: number, y: number, s: string, o: { size: number; weight?: number; color?: string; anchor?: "start" | "middle" | "end"; latin?: boolean; opacity?: number }) =>
  `<text x="${x}" y="${y}" font-family="${o.latin ? LATIN : FONT}" font-size="${o.size}" font-weight="${o.weight ?? 400}" fill="${o.color ?? C.ink}"${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ""} direction="${o.latin ? "ltr" : "rtl"}" text-anchor="${o.anchor ?? "start"}" xml:space="preserve">${esc(s)}</text>`;

/** صفحةٌ تُبنى عموداً — ومؤشّرُها ينزل، وتنتقل إلى صفحةٍ جديدة إن لم يتّسع ما بعدها */
class Doc {
  pages: string[][] = [];
  y = 0;
  private uid = 0;
  constructor(private head: { title: string; subtitle: string }) {
    this.newPage();
  }
  id() {
    return `c${++this.uid}`;
  }
  get page() {
    return this.pages[this.pages.length - 1];
  }
  newPage(continued?: string) {
    this.pages.push([]);
    this.y = HEADER_H + 36;
    if (continued) {
      this.page.push(text(W - M, this.y + 20, `${continued} (تابع)`, { size: 24, weight: 700, color: C.muted }));
      this.y += 44;
    }
  }
  /** يضمن مساحةً بارتفاع `h` — وإلا صفحةٌ جديدة */
  ensure(h: number, continued?: string) {
    if (this.y + h > H - FOOTER_H - 20) this.newPage(continued);
  }
  frame(i: number, n: number, stamp: string) {
    const logo = EMAIL_BRAND_ASSETS.logo;
    return [
      `<rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="${C.ink}"/>`,
      `<image x="${M}" y="${(HEADER_H - 76) / 2}" width="${Math.round((76 * logo.width) / logo.height)}" height="76" href="data:image/png;base64,${logo.base64}"/>`,
      text(W - M, 54, this.head.title, { size: 36, weight: 700, color: C.beige }),
      text(W - M, 88, this.head.subtitle, { size: 19, color: C.beige, opacity: 0.8 }),
      `<line x1="${M}" y1="${H - FOOTER_H}" x2="${W - M}" y2="${H - FOOTER_H}" stroke="${C.rule}" stroke-width="2"/>`,
      text(W - M, H - FOOTER_H + 34, stamp, { size: 17, color: C.muted }),
      text(W / 2, H - FOOTER_H + 34, "نلتقي • نفكر • نصنع", { size: 17, color: C.accent, anchor: "middle" }),
      text(M, H - FOOTER_H + 34, `${i + 1} / ${n}`, { size: 17, color: C.muted, latin: true }),
    ];
  }
}

type PortraitImg = { href: string; kind: "photo" | "default" | "initials"; text: string };
const SIZES = { xl: { w: 176, h: 218, name: 27, title: 19, etid: 17 }, md: { w: 132, h: 164, name: 22, title: 17, etid: 15 }, sm: { w: 100, h: 124, name: 18, title: 14, etid: 13 } } as const;
type Size = keyof typeof SIZES;

/** بطاقةُ شخص: صورتُه في قوسٍ علويٍّ على محرابٍ بيجيّ، ثم اسمُه ومسمّاه ورقمُه الوظيفي — متمركزةً حول `cx` */
function card(doc: Doc, cx: number, top: number, p: OrgPersonView, img: PortraitImg | undefined, size: Size, colW: number): string {
  const s = SIZES[size];
  const x = cx - s.w / 2;
  const r = s.w / 2;
  const id = doc.id();
  const clip = `<clipPath id="${id}"><rect x="${x}" y="${top}" width="${s.w}" height="${s.h}" rx="${r}" ry="${r}"/><rect x="${x}" y="${top + r}" width="${s.w}" height="${s.h - r}"/></clipPath>`;
  const niche = `<g clip-path="url(#${id})"><rect x="${x}" y="${top}" width="${s.w}" height="${s.h}" fill="#E4EBD3"/><rect x="${x}" y="${top + s.h * 0.35}" width="${s.w}" height="${s.h * 0.65}" fill="${C.beige}"/>`;
  let face = "";
  if (img && img.kind === "photo") face = `<image x="${x}" y="${top}" width="${s.w}" height="${s.h}" preserveAspectRatio="xMidYMin slice" href="${img.href}"/>`;
  else if (img && img.kind === "default") face = `<image x="${x}" y="${top + s.h * 0.06}" width="${s.w}" height="${s.h * 0.94}" preserveAspectRatio="xMidYMax meet" href="${img.href}"/>`;
  else face = text(cx, top + s.h * 0.62, img?.text ?? p.name.slice(0, 1), { size: Math.round(s.w * 0.32), weight: 700, color: C.ink, anchor: "middle" });
  const lines = [
    text(cx, top + s.h + s.name + 10, fit(p.name, s.name, colW - 8), { size: s.name, weight: 700, anchor: "middle" }),
    p.title ? text(cx, top + s.h + s.name + s.title + 18, fit(p.title, s.title, colW - 8), { size: s.title, color: C.muted, anchor: "middle" }) : "",
    p.etid ? text(cx, top + s.h + s.name + s.title + s.etid + 26, p.etid, { size: s.etid, color: C.muted, anchor: "middle", latin: true }) : "",
  ];
  return `<defs>${clip}</defs>${niche}${face}</g>${lines.join("")}`;
}
const cardH = (size: Size) => SIZES[size].h + SIZES[size].name + SIZES[size].title + SIZES[size].etid + 40;

/** صفٌّ متمركزٌ من البطاقات يلتفّ على الصفحة */
function cardRows(doc: Doc, keys: string[], P: OrgGraph["people"], imgs: Map<string, PortraitImg>, size: Size, colW: number, continued?: string) {
  const perRow = Math.max(1, Math.floor((W - 2 * M) / colW));
  for (let i = 0; i < keys.length; i += perRow) {
    const row = keys.slice(i, i + perRow).filter((k) => P[k]);
    doc.ensure(cardH(size), continued);
    const total = row.length * colW;
    // RTL: الأولُ يميناً
    row.forEach((k, j) => {
      const cx = W / 2 + total / 2 - colW / 2 - j * colW;
      doc.page.push(card(doc, cx, doc.y, P[k], imgs.get(k), size, colW));
    });
    doc.y += cardH(size) + 12;
  }
}

/** عنوانُ قسمٍ من الصفحة — **لا يُترك وحيداً في أسفلها:** يُضمن له ولأول ما تحته (`next`) مكانٌ واحد */
function sectionTitle(doc: Doc, s: string, sub?: string, continued?: string, next = 0) {
  doc.ensure((sub ? 92 : 62) + next, continued);
  doc.page.push(text(W - M, doc.y + 30, s, { size: 28, weight: 700, color: C.accent }));
  if (sub) doc.page.push(text(W - M, doc.y + 60, sub, { size: 18, color: C.muted }));
  doc.page.push(`<line x1="${M}" y1="${doc.y + (sub ? 74 : 44)}" x2="${W - M}" y2="${doc.y + (sub ? 74 : 44)}" stroke="${C.rule}" stroke-width="2"/>`);
  doc.y += sub ? 92 : 62;
}

/** سطورٌ ملتفّةٌ تقريبياً بعرض العمود — لأسماء أعضاء اللجنة */
function wrap(s: string, size: number, maxW: number, maxLines: number): string[] {
  const per = Math.max(8, Math.floor(maxW / (size * 0.5)));
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > per) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = `${cur} ${w}`;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.?$/, "…");
  return lines;
}

function committees(doc: Doc, unit: OrgUnitView, P: OrgGraph["people"], continued: string) {
  if (unit.committees.length === 0) return;
  sectionTitle(doc, `اللجان (${unit.committees.length})`, undefined, continued, 104);
  const STATUS: Record<string, string> = { approved: "عاملة", awaiting_lead: "بانتظار تعيين قائد" };
  for (const c of unit.committees) {
    const lead = c.leadKey ? P[c.leadKey]?.name : null;
    const names = [...c.memberKeys, ...c.referenceKeys].map((k) => {
      const n = P[k]?.name;
      const r = c.responsibilities[k];
      return n ? (r ? `${n} (${r})` : n) : null;
    }).filter(Boolean) as string[];
    const lines = names.length ? wrap(`الأعضاء: ${names.join("، ")}`, 18, W - 2 * M - 40, 3) : ["لا أعضاء بعد"];
    const h = 64 + lines.length * 28;
    doc.ensure(h + 12, continued);
    const y = doc.y;
    doc.page.push(`<rect x="${M}" y="${y}" width="${W - 2 * M}" height="${h}" rx="18" fill="${C.soft}" stroke="${C.rule}" stroke-width="2"/>`);
    doc.page.push(`<rect x="${W - M - 6}" y="${y + 14}" width="6" height="${h - 28}" rx="3" fill="${C.accent}"/>`);
    // الاسمُ وحالتُها سطرٌ واحد (اتجاهٌ واحد — لا موضعَ يُقدَّر بطول الاسم)
    doc.page.push(text(W - M - 24, y + 36, `${fit(c.name, 23, 760)} · ${STATUS[c.status ?? ""] ?? "—"}`, { size: 23, weight: 700 }));
    doc.page.push(text(M + 24, y + 36, lead ? `القائد: ${lead}` : "قيادتُها شاغرة", { size: 19, weight: 700, color: lead ? C.ink : C.accent, anchor: "end" }));
    lines.forEach((l, i) => doc.page.push(text(W - M - 24, y + 70 + i * 28, l, { size: 18, color: C.ink })));
    doc.y += h + 12;
  }
}

/** صورُ الأشخاص: المرفوعةُ من القاعدة، والهيئتان الرسميتان بالجنس، وإلا الحرفُ الأول — مصغّرةً لحجم البطاقة */
async function loadPortraits(P: OrgGraph["people"]): Promise<Map<string, PortraitImg>> {
  const out = new Map<string, PortraitImg>();
  const want: { key: string; kind: "user" | "member"; id: string }[] = [];
  for (const p of Object.values(P)) {
    const pr = p.portrait;
    if (pr.kind === "photo") {
      const m = /\/api\/avatar\/(user|member)\/([^?]+)/.exec(pr.src);
      if (m) want.push({ key: p.key, kind: m[1] as "user" | "member", id: decodeURIComponent(m[2]) });
    } else if (pr.kind === "default") {
      const g = /default-(male|female)/.exec(pr.src)?.[1];
      const buf = g ? defaultPortrait(g) : null;
      if (buf) {
        const png = await sharp(buf).resize({ width: 220 }).png().toBuffer();
        out.set(p.key, { kind: "default", href: `data:image/png;base64,${png.toString("base64")}`, text: "" });
      }
    }
    if (!out.has(p.key) && pr.kind !== "photo") out.set(p.key, { kind: "initials", href: "", text: pr.kind === "initials" ? pr.text : p.name.slice(0, 1) });
  }
  const [users, members] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: want.filter((w) => w.kind === "user").map((w) => w.id) } }, select: { id: true, avatarData: true } }),
    prisma.member.findMany({ where: { id: { in: want.filter((w) => w.kind === "member").map((w) => w.id) } }, select: { id: true, avatarData: true } }),
  ]);
  const data = new Map([...users.map((u) => [`user:${u.id}`, u.avatarData] as const), ...members.map((m) => [`member:${m.id}`, m.avatarData] as const)]);
  for (const w of want) {
    const raw = data.get(`${w.kind}:${w.id}`);
    const m = raw ? /^data:image\/[a-z+]+;base64,(.+)$/i.exec(raw) : null;
    try {
      if (!m) throw new Error("no photo");
      const jpg = await sharp(Buffer.from(m[1], "base64")).resize({ width: 260, height: 320, fit: "cover", position: "top" }).jpeg({ quality: 86 }).toBuffer();
      out.set(w.key, { kind: "photo", href: `data:image/jpeg;base64,${jpg.toString("base64")}`, text: "" });
    } catch {
      out.set(w.key, { kind: "initials", href: "", text: P[w.key]?.name.slice(0, 1) ?? "" });
    }
  }
  return out;
}

export async function renderStructurePdf(graph: OrgGraph, opts: { date: string; ready: boolean; blockers: string[] }): Promise<{ pdf: Buffer; pages: number; people: number }> {
  ensureFonts();
  const P = graph.people;
  const imgs = await loadPortraits(P);
  const stamp = opts.ready ? `النسخة الرسمية — ${opts.date}` : `نسخة عمل (غير رسمية) — ${opts.date}`;
  const doc = new Doc({ title: "هيكل تلاق التنظيمي", subtitle: `${graph.counts.people} شخصاً · ${graph.counts.departments} أقسام · ${graph.counts.committees} لجنة · ${opts.date}` });

  // ═══ الغلاف: النواقص (إن وُجدت)، ثم القيادة ═══
  if (!opts.ready && opts.blockers.length) {
    const lines = opts.blockers.slice(0, 4);
    const h = 56 + lines.length * 28;
    doc.page.push(`<rect x="${M}" y="${doc.y}" width="${W - 2 * M}" height="${h}" rx="18" fill="#FFF6E5" stroke="#E8C77A" stroke-width="2"/>`);
    doc.page.push(text(W - M - 24, doc.y + 36, "نسخة عمل: الهيكل لم يكتمل بعد، والنسخةُ الرسمية تصدر عند اكتماله. النواقص:", { size: 19, weight: 700, color: "#7A4B00" }));
    lines.forEach((b, i) => doc.page.push(text(W - M - 40, doc.y + 66 + i * 28, `• ${b}`, { size: 17, color: "#7A4B00" })));
    doc.y += h + 20;
  }
  const top = [graph.founderKey, graph.ceoKey].filter(Boolean) as string[];
  if (top.length) cardRows(doc, top, P, imgs, "xl", 300);
  const exec = [...graph.operations.map((o) => o.key), ...graph.extraLeaders];
  if (exec.length) {
    sectionTitle(doc, "القيادة التنفيذية والمتابعة", undefined, undefined, cardH("md"));
    cardRows(doc, exec, P, imgs, "md", 230);
  }
  if (graph.senior) {
    const s = graph.senior;
    const holders = graph.seniorPositions.filter((x) => P[x.key]?.roles[0]?.kind === "senior_position").map((x) => x.key);
    const people = [...holders, ...s.memberKeys.filter((k) => !holders.includes(k))];
    if (people.length || s.committees.length) {
      sectionTitle(doc, s.name, `${people.length} شخصاً · ${s.committees.length} لجنة`, s.name, people.length ? cardH("md") : 104);
      if (people.length) cardRows(doc, people, P, imgs, "md", 230, s.name);
      committees(doc, s, P, s.name);
    }
  }

  // ═══ لكلّ قسمٍ صفحتُه ═══
  for (const d of graph.departments) {
    doc.newPage();
    const overseers = d.overseerKeys.map((k) => P[k]?.name).filter(Boolean);
    doc.page.push(text(W - M, doc.y + 38, d.name, { size: 40, weight: 700 }));
    doc.page.push(
      text(W - M, doc.y + 74, `${d.memberCount} عضواً · ${d.committeeCount ? `${d.committeeCount} لجان` : "لا لجان بعد"}${overseers.length ? ` · يتابعه: ${overseers.join("، ")}` : ""}`, { size: 19, color: C.muted })
    );
    doc.page.push(`<rect x="${W - M - 120}" y="${doc.y + 90}" width="120" height="5" rx="2.5" fill="${C.accent}"/>`);
    doc.y += 116;
    const leaders = [d.leadKey && !d.leadIsReference ? d.leadKey : null, d.deputyKey].filter(Boolean) as string[];
    if (leaders.length) cardRows(doc, leaders, P, imgs, "md", 260, d.name);
    else {
      doc.page.push(text(W / 2, doc.y + 30, d.leadKey ? `القائد: ${P[d.leadKey]?.name ?? ""}` : "قيادة القسم شاغرة", { size: 22, weight: 700, color: C.accent, anchor: "middle" }));
      doc.y += 60;
    }
    committees(doc, d, P, d.name);
    if (d.memberKeys.length) {
      sectionTitle(doc, `أعضاء القسم (${d.memberKeys.length})`, undefined, d.name, cardH("sm"));
      cardRows(doc, d.memberKeys, P, imgs, "sm", 150, d.name);
    }
  }

  if (graph.unassignedKeys.length) {
    doc.newPage();
    sectionTitle(doc, `بلا قسم (${graph.unassignedKeys.length})`, undefined, undefined, cardH("sm"));
    cardRows(doc, graph.unassignedKeys, P, imgs, "sm", 150, "بلا قسم");
  }
  if (graph.issues.length) {
    doc.ensure(120);
    sectionTitle(doc, `حالاتٌ تحتاج مراجعة (${graph.issues.length})`, "تظهر للقيادة وحدها — من بيانات المنصة كما هي", undefined, 32);
    for (const i of graph.issues.slice(0, 30)) {
      doc.ensure(32);
      doc.page.push(text(W - M - 16, doc.y + 22, `• ${i.detail}`, { size: 17, color: C.ink }));
      doc.y += 30;
    }
  }

  // ═══ الرسم: كلُّ صفحةٍ SVG ← JPEG، ثم PDF ═══
  const n = doc.pages.length;
  const jpegs = [];
  for (let i = 0; i < n; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#FFFFFF"/>${doc.frame(i, n, stamp).join("")}${doc.pages[i].join("")}</svg>`;
    const jpeg = await sharp(Buffer.from(svg)).flatten({ background: "#FFFFFF" }).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
    jpegs.push({ jpeg, width: W, height: H });
  }
  return { pdf: pdfFromJpegs(jpegs, { pageWidthPt: 842, pageHeightPt: 595, title: "هيكل تلاق التنظيمي" }), pages: n, people: graph.counts.people };
}
