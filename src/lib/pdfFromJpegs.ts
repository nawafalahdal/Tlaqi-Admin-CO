/** **ملفُّ PDF من صفحاتٍ مصوَّرة** — كلُّ صفحةٍ صورةُ JPEG بملء الورقة (`DCTDecode`)، بلا مكتبةٍ جديدة.
 *
 *  **لماذا صورٌ لا نصّ:** النصُّ عربي، ومكتباتُ PDF في Node تقطّع الحروفَ أو تحتاج متصفّحاً كاملاً داخل الدالة (انظر
 *  `structure/pdf/page.tsx`). أمّا الرسمُ بـsharp (librsvg + pango) فيشكّل العربيةَ ويصلها — وهو الطريقُ الذي تُرسم به
 *  اللوحةُ الترحيبية وترويسةُ البريد في الإنتاج. فتُرسم الصفحةُ صورةً، ويُغلَّف هنا ملفاً يُنزَّل ويُطبع ويُرسَل.
 *
 *  البنية (PDF 1.4): فهرسٌ ← صفحات ← لكل صفحة: صفحةٌ + صورتها + سطرُ رسمٍ واحد يمدّها على الورقة. */
export function pdfFromJpegs(
  pages: { jpeg: Buffer; width: number; height: number }[],
  opts: { pageWidthPt: number; pageHeightPt: number; title?: string }
): Buffer {
  if (pages.length === 0) throw new Error("لا صفحات");
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    chunks.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: (Buffer | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const b of body) push(b);
    push("\nendobj\n");
  };

  // الترقيم: 1 فهرس، 2 صفحات، 3 معلومات، ثم لكل صفحة ثلاثة: الصفحة، الصورة، سطرُ الرسم
  const pageObj = (i: number) => 4 + i * 3;
  const { pageWidthPt: W, pageHeightPt: H } = opts;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`]);
  // العنوانُ بـUTF-16BE (عربيٌّ يظهر في خصائص الملف)
  const title = opts.title ? `<FEFF${Buffer.from(opts.title, "utf16le").swap16().toString("hex").toUpperCase()}>` : "()";
  obj(3, [`<< /Title ${title} /Producer (TLAQI) >>`]);

  pages.forEach((p, i) => {
    const n = pageObj(i);
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`]);
    obj(n + 1, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      "\nendstream",
    ]);
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(n + 2, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
