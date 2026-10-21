"use client";

import { useState, useTransition } from "react";
import { decideGoalAction, decideObjectiveAction } from "../actions";
import { Button } from "@/components/ui";
import type { themeFromColor } from "@/lib/brand";

import { useTranslations } from "@/i18n/LocaleProvider";
/** قرارُ الإدارة في مقترَح — والردُّ لا يقع بلا سببٍ مكتوب */
export function ProposalDecision({
  kind,
  id,
  theme,
}: {
  kind: "goal" | "objective";
  id: string;
  theme: ReturnType<typeof themeFromColor>;
}) {
  const L = useTranslations().rProposalDecision;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function run(decision: "approved" | "rejected") {
    start(async () => {
      setError(null);
      const res =
        kind === "goal"
          ? await decideGoalAction(id, decision, note)
          : await decideObjectiveAction(id, decision, note);
      if (res.error) setError(res.error);
      else setNote("");
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-black/5 pt-3">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={L.decisionNoteRequiredWhen}
        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
      />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button theme={theme} disabled={pending} onClick={() => run("approved")}>{L.approveIt}</Button>
        <Button
          theme={theme}
          variant="outline"
          disabled={pending || !note.trim()}
          onClick={() => run("rejected")}
        >{L.returnWithAReason}</Button>
      </div>
    </div>
  );
}
