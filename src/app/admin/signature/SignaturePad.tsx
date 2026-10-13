"use client";

import { useRef, useState, useTransition } from "react";
import { submitSignatureAction } from "./actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

/** لوح التوقيع — يُرسَم بالإصبع أو الفأرة، أو تُرفع صورةٌ جاهزة.
 *
 *  والرسم المباشر مقصود: من يُطلب منه توقيعٌ على جواله لا يجد ماسحاً
 *  ضوئياً، وتصويرُ ورقةٍ يُنتج خلفيةً رمادية تُرسَم على الشهادة.
 *
 *  والخلفية شفّافة عمداً: الشهادة أربع خلفيات ملوّنة، وتوقيعٌ بخلفيةٍ
 *  بيضاء يُنتج مستطيلاً أبيض على الأخضر والبرتقالي. */
export function SignaturePad({ theme }: { theme: ReturnType<typeof themeFromColor> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function ctx() {
    const c = canvasRef.current;
    if (!c) return null;
    const g = c.getContext("2d");
    if (!g) return null;
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#1A1023";
    return g;
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    // الإحداثيات تُقاس بنسبة اللوح لا بالبكسل المعروض: اللوح ٧٠٠×٢٢٠
    // وقد يُعرض أضيق على الجوال، فالرسم ينزلق بلا هذه النسبة.
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const g = ctx();
    if (!g) return;
    drawing.current = true;
    dirty.current = true;
    const p = pos(e);
    g.beginPath();
    g.moveTo(p.x, p.y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const g = ctx();
    if (!g) return;
    const p = pos(e);
    g.lineTo(p.x, p.y);
    g.stroke();
  }

  function up() {
    drawing.current = false;
  }

  function clear() {
    const c = canvasRef.current;
    const g = ctx();
    if (!c || !g) return;
    g.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    setMsg(null);
  }

  function send(dataUrl: string) {
    setMsg(null);
    start(async () => {
      const res = await submitSignatureAction(dataUrl);
      setMsg(
        res.error
          ? { kind: "err", text: res.error }
          : { kind: "ok", text: "رُفع توقيعك — ينتظر اعتماد الإدارة قبل أن يُرسَم على أي شهادة" }
      );
    });
  }

  function submitDrawn() {
    if (!dirty.current) {
      setMsg({ kind: "err", text: "ارسم توقيعك أولاً" });
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    send(c.toDataURL("image/png"));
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // الحدّ يُفرَض هنا أيضاً لتُقال الرسالة قبل الرفع — والخادم يفرضه
    if (file.size > 400_000) {
      setMsg({ kind: "err", text: "حجم الصورة أكبر من ٤٠٠ كيلوبايت" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => send(String(reader.result));
    reader.onerror = () => setMsg({ kind: "err", text: "تعذّر قراءة الصورة" });
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={700}
        height={220}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="w-full touch-none rounded-xl border-2 border-dashed border-black/15 bg-white"
        style={{ aspectRatio: "700 / 220" }}
      />
      <p className="mt-1.5 text-xs text-black/40">ارسم توقيعك داخل الإطار بإصبعك أو بالفأرة.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button theme={theme} disabled={pending} onClick={submitDrawn}>
          {pending ? "يُرفَع..." : "ارفع التوقيع المرسوم"}
        </Button>
        <Button theme={theme} variant="outline" disabled={pending} onClick={clear}>
          امسح
        </Button>
        <label className="text-xs text-black/55">
          <span className="block pb-1">أو ارفع صورة (PNG / JPEG)</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={pending}
            onChange={onFile}
            className="text-xs"
          />
        </label>
      </div>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
