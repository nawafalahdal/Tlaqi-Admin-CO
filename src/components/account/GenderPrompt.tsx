"use client";

import { useActionState } from "react";
import { setMyGenderAction } from "@/lib/genderActions";
import { useTranslations } from "@/i18n/LocaleProvider";
import { NavGlyph } from "../icons";

/** سؤالٌ واحد لمن لم يختر مخاطبته بعد — يظهر أعلى مساحة العمل حتى يُجاب.
 *
 *  من سجّل قبل وجود الحقل لا طريق آخر له إليه غير نموذج بياناته، وأكثرُ
 *  الناس لا يفتحونه. فيُسأل مرّةً في موضعٍ يراه، بضغطةٍ واحدة، ثم يختفي. */
export function GenderPrompt() {
  const t = useTranslations().gender;
  const [state, action, pending] = useActionState(setMyGenderAction, { saved: false, error: null });

  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 pt-4 sm:px-5">
      <form action={action} className="ticket-cta" aria-label={t.promptTitle}>
        <span className="ticket-cta__icon" aria-hidden="true">
          <NavGlyph name="members" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="ticket-cta__title">{t.promptTitle}</h2>
          <p className="ticket-cta__body" role="status">
            {state.saved ? t.promptSaved : state.error ?? t.promptBody}
          </p>
        </div>
        {!state.saved && (
          <div className="flex w-full gap-2 sm:w-auto">
            {(["female", "male"] as const).map((v) => (
              <button
                key={v}
                type="submit"
                name="gender"
                value={v}
                disabled={pending}
                className="btn-brand ticket-cta__btn flex-1 justify-center"
              >
                {pending ? t.saving : t[v]}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
