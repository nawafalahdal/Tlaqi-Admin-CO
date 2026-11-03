/** يبني PDF وثيقة الحوكمة من مصدرها Markdown — المصدرُ واحد، والـPDF نسخةٌ منه لا تُحرَّر يدوياً.
 *
 *  يحوّل ما تستعمله الوثيقة وحده: العناوين، الفقرات، الاقتباس، القوائم، الجداول، الخط العريض، الشيفرة، الفاصل.
 *  وتصنيفات القواعد ([معتمد]، [قائم]، [مقترح]، [قرار معلّق]) تُرسم شاراتٍ ملوّنة.
 *
 *    node scripts/build-governance-pdf.mjs [in.md] [out.pdf] */
import pw from "/opt/node-tools/node_modules/playwright/index.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = pw;
const ROOT = process.cwd();
const IN = path.resolve(process.argv[2] ?? "docs/TLAQI_PLATFORM_GOVERNANCE_AR.md");
const OUT = path.resolve(process.argv[3] ?? IN.replace(/\.md$/, ".pdf"));
const url = (p) => pathToFileURL(p).href;
const font = (f) => url(path.join(ROOT, "assets/fonts", f));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BADGES = { "معتمد": "ok", "قائم": "now", "مقترح": "prop", "قرار معلّق": "pend" };

/** السطرُ الواحد: شيفرة، ثم عريض، ثم شارات التصنيف */
function inline(raw) {
  const parts = raw.split(/(`[^`]+`)/g);
  return parts
    .map((p) => {
      if (p.startsWith("`") && p.endsWith("`")) return `<code dir="ltr">${esc(p.slice(1, -1))}</code>`;
      let h = esc(p).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      // والوسمُ قد يحمل مرجعَه: «[معتمد — ملاحظة المؤسس ٤]» ← الوسمُ ثم المرجعُ بخطٍّ أخفّ
      h = h.replace(/\[(معتمد|قائم|مقترح|قرار معلّق)(?: — ([^\]]+))?\]/g, (_, k, note) =>
        `<span class="badge ${BADGES[k]}">${k}</span>${note ? ` <span class="badge-note">${note}</span>` : ""}`);
      return h;
    })
    .join("");
}

function render(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^---+$/.test(line.trim())) { out.push("<hr>"); i++; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      // داخل الاقتباس: فقراتٌ وقوائم بترتيبها، والسطرُ الفارغ يفصل الفقرات
      const blocks = [];
      let para = [];
      let items = [];
      const flush = () => {
        if (para.length) blocks.push(`<p>${para.join(" ")}</p>`);
        if (items.length) blocks.push(`<ul>${items.join("")}</ul>`);
        para = [];
        items = [];
      };
      for (const b of buf) {
        if (/^- /.test(b)) {
          if (para.length) { blocks.push(`<p>${para.join(" ")}</p>`); para = []; }
          items.push(`<li>${inline(b.slice(2))}</li>`);
        } else if (!b.trim()) flush();
        else {
          if (items.length) { blocks.push(`<ul>${items.join("")}</ul>`); items = []; }
          para.push(inline(b));
        }
      }
      flush();
      out.push(`<blockquote>${blocks.join("")}</blockquote>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`);
      continue;
    }
    if (/^- /.test(line)) {
      // قائمةٌ بمستوى فرعيٍّ واحد: «  - » تحت البند الذي قبلها (والأعمقُ يُسطَّح إليه)،
      // والسطرُ المُزاحُ بلا «- » تكملةٌ للبند الذي قبله — لا ينهي القائمة فيبتلعَ ما بعده فقرةً
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        const l = lines[i];
        if (/^- /.test(l)) items.push({ text: inline(l.slice(2)), subs: [] });
        else if (/^\s{2,}- /.test(l)) { if (items.length) items[items.length - 1].subs.push(inline(l.replace(/^\s+- /, ""))); }
        else if (items.length) {
          const it = items[items.length - 1];
          if (it.subs.length) it.subs[it.subs.length - 1] += " " + inline(l.trim());
          else it.text += " " + inline(l.trim());
        }
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${it.text}${it.subs.length ? `<ul>${it.subs.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|\||- |---)/.test(lines[i])) { para.push(inline(lines[i])); i++; }
    out.push(`<p>${para.join(" ")}</p>`);
  }
  return out.join("\n");
}

const body = render(fs.readFileSync(IN, "utf8"));
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:"CairoG";src:url("${font("Cairo-Regular.ttf")}");font-weight:400}
@font-face{font-family:"CairoG";src:url("${font("Cairo-Bold.ttf")}");font-weight:700}
@page{size:A4;margin:16mm 14mm 18mm}
*{box-sizing:border-box}
body{font-family:"CairoG",sans-serif;color:#1A1023;font-size:10.5pt;line-height:1.75;margin:0}
h1{font-size:21pt;color:#341D2B;margin:0 0 6mm;padding-bottom:3mm;border-bottom:3px solid #C34900}
h2{font-size:13.5pt;color:#341D2B;margin:7mm 0 2mm;break-after:avoid}
h3{font-size:12pt;color:#341D2B;margin:5mm 0 2mm;break-after:avoid}
p{margin:0 0 2mm}
ul{margin:0 0 2mm;padding-inline-start:6mm}
li{margin:0 0 1.2mm}
blockquote{margin:0 0 5mm;padding:3mm 4mm;background:#F6F1F4;border-inline-start:4px solid #341D2B;border-radius:2mm}
blockquote p,blockquote ul{margin:0 0 1.5mm}
code{font-family:"DejaVu Sans Mono",monospace;font-size:8.5pt;background:#F2EEF1;padding:0 1mm;border-radius:1mm;unicode-bidi:isolate}
table{width:100%;border-collapse:collapse;margin:2mm 0 4mm;font-size:9.5pt;break-inside:auto}
th,td{border:1px solid #D9D0D6;padding:1.6mm 2mm;text-align:start;vertical-align:top}
th{background:#341D2B;color:#fff}
tr{break-inside:avoid}
hr{border:0;border-top:1px solid #D9D0D6;margin:6mm 0}
.badge{display:inline-block;font-size:8pt;font-weight:700;line-height:1.5;padding:0 2mm;border-radius:2mm;margin-inline-end:1mm;white-space:nowrap}
.badge-note{font-size:8pt;color:#6b5a64;font-weight:600}
li ul{margin:1mm 0 0;padding-inline-start:5mm}
.badge.ok{background:#E3F4EA;color:#1F6B43;border:1px solid #67C090}
.badge.now{background:#EFE8EC;color:#341D2B;border:1px solid #8A6B7E}
.badge.prop{background:#FCEBDD;color:#8A3300;border:1px solid #C34900}
.badge.pend{background:#FFF4D6;color:#7A5A00;border:1px solid #D9A400}
</style></head><body>${body}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:8px;color:#8A6B7E;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log(`PDF: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
