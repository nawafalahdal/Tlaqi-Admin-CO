"use client";

import { useEffect, useState } from "react";
import type { MarketingChatKind } from "@prisma/client";
import { useTranslations } from "@/i18n/LocaleProvider";
import { fmt } from "@/i18n/fmt";
import { mkMessage } from "@/lib/marketing/messages";
import type { ChatViewData } from "@/lib/marketing/ai/chatView";
import { useLocale } from "@/i18n/LocaleProvider";
import { pollChat } from "../actions";
import { ActionForm } from "./ActionForm";
import { Pill, areaCls, when } from "./bits";

/** شاتُ المهمّة — يقول الحقيقةَ عن حالته قبل أي زرّ.
 *
 *  - **الكتابةُ بشرط الخادم** (`chatGate`): من لا يملكها يقرأ المحادثةَ ويُقال له لماذا لا يكتب.
 *  - **الرسالةُ محفوظةٌ قبل الإرسال:** الإرسالُ يعود فوراً، والردُّ يُعالَج بعده؛ وما دام ردٌّ منتظراً
 *    تُسأل الحالةُ كل بضع ثوانٍ (`pollChat`)، وهي التي تُشغّل الإعادةَ المجدولة حين يحين موعدها.
 *  - **القديمُ لا يُعرض كأنه حالي:** ردٌّ تغيّرت مهمّتُه بعد سؤاله معلَّمٌ بذلك.
 *  - **المحاكاةُ معلَّمة**، والمزوّدُ غيرُ المهيّأ يُقال اسمُه لا يُخفى. */

type Scope = { kind: MarketingChatKind; campaignId: string | null; deliverableId?: string | null };
/** نقلُ الرد إلى صفحته: إلى مسودة النص (للكاتب) أو وصف التصميم (للمصمّم والمنسّق) — على منشور السياق */
type Transfer = { deliverableId: string; toDraft: boolean; toDesign: boolean };

export function ChatPanel({ scope, initial, transfer, contextLabel }: { scope: Scope; initial: ChatViewData; transfer?: Transfer | null; contextLabel?: string | null }) {
  const mk = useTranslations().mk;
  const { locale } = useLocale();
  const L = mk.chat;
  const [polled, setPolled] = useState<{ from: ChatViewData; data: ChatViewData } | null>(null);
  const data = polled && polled.from === initial ? polled.data : initial;
  const pending = data.messages.some((m) => m.role === "assistant" && (m.status === "queued" || m.status === "running"));

  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const id = window.setInterval(async () => {
      const next = await pollChat({ kind: scope.kind, campaignId: scope.campaignId, deliverableId: scope.deliverableId ?? null }).catch(() => null);
      if (!stop && next) setPolled({ from: initial, data: next });
    }, 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [pending, scope.kind, scope.campaignId, scope.deliverableId, initial]);

  const blockedText = data.blocked ? mkMessage(mk, { code: data.blocked.code as never, params: data.blocked.params ?? undefined }, locale) : null;
  const errorText = (e: string | null) => (e ? (L.errors as Record<string, string>)[e] ?? (mk.errors as Record<string, string>)[e] ?? e : "");

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] p-3" data-chat={scope.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{L.titles[scope.kind]}</span>
        {data.ai.simulated && <Pill tone="review">{L.simulated}</Pill>}
        {data.paused && <Pill tone="bad">{L.paused}</Pill>}
      </div>
      <p className="text-xs leading-relaxed text-black/55">{L.hints[scope.kind]}</p>
      {contextLabel && <p className="text-[11px] font-bold text-[#1a0e1c]/70">{contextLabel}</p>}
      {data.ai.state !== "ready" && (
        <p className="text-xs text-amber-900">{fmt(L.notConfigured, data.ai.reason ? (mk.ai.reasons as Record<string, string>)[data.ai.reason] ?? data.ai.reason : mk.ai.states[data.ai.state])}</p>
      )}

      {data.messages.length === 0 ? (
        <p className="text-sm text-black/50">{L.empty}</p>
      ) : (
        <ol className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto" aria-live="polite">
          {data.messages.map((m) => (
            <li key={m.id} className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-black/[0.04]" : "border border-black/[0.06]"}`}>
              <p className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-black/50">
                <span className="font-bold">{m.role === "user" ? L.you : L.assistant}</span>
                <span>{when(m.createdAt)}</span>
                {m.role === "assistant" && m.status !== "done" && (
                  <Pill tone={m.status === "failed" ? "bad" : m.status === "stale" ? "review" : "neutral"}>{L.states[m.status]}</Pill>
                )}
                {m.role === "assistant" && m.error && m.status !== "done" && <span>{errorText(m.error)}</span>}
                {m.role === "assistant" && (m.status === "queued" || m.status === "failed") && m.attempts > 0 && <span>{fmt(L.attempts, m.attempts, m.maxAttempts)}</span>}
              </p>
              {m.body && <p className={`whitespace-pre-wrap ${m.status === "stale" ? "text-black/50" : ""}`} dir="auto">{m.body}</p>}
              {m.role === "assistant" && m.status === "done" && transfer && (transfer.toDraft || transfer.toDesign) && (
                <div className="mt-2 flex flex-wrap gap-2" data-chat-transfer>
                  {transfer.toDraft && (
                    <ActionForm op="chat.transfer" submit={L.toDraft} variant="outline" inline>
                      <input type="hidden" name="replyId" value={m.id} />
                      <input type="hidden" name="target" value="draft" />
                      <input type="hidden" name="deliverableId" value={transfer.deliverableId} />
                    </ActionForm>
                  )}
                  {transfer.toDesign && (
                    <ActionForm op="chat.transfer" submit={L.toDesign} variant="outline" inline>
                      <input type="hidden" name="replyId" value={m.id} />
                      <input type="hidden" name="target" value="design" />
                      <input type="hidden" name="deliverableId" value={transfer.deliverableId} />
                    </ActionForm>
                  )}
                </div>
              )}
              {m.role === "assistant" && data.canWrite && (m.status === "failed" || m.status === "queued" || m.status === "running") && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.status === "failed" && (
                    <ActionForm op="chat.retry" submit={L.retry} variant="outline" inline>
                      <input type="hidden" name="replyId" value={m.id} />
                    </ActionForm>
                  )}
                  {m.status !== "failed" && (
                    <ActionForm op="chat.cancel" submit={L.cancel} variant="ghost" inline>
                      <input type="hidden" name="replyId" value={m.id} />
                    </ActionForm>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {data.canWrite ? (
        <ActionForm op="chat.send" submit={L.send} resetOnSuccess>
          <input type="hidden" name="kind" value={scope.kind} />
          {scope.campaignId && <input type="hidden" name="campaignId" value={scope.campaignId} />}
          {scope.deliverableId && <input type="hidden" name="deliverableId" value={scope.deliverableId} />}
          <textarea name="body" rows={3} required maxLength={4000} placeholder={L.placeholder} aria-label={L.placeholder} className={areaCls} dir="auto" />
          <p className="text-[11px] text-black/45">{L.privacy}</p>
        </ActionForm>
      ) : (
        blockedText && <p className="text-xs text-black/60">{fmt(L.readOnly, blockedText)}</p>
      )}
    </div>
  );
}
