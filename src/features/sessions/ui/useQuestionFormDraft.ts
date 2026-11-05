import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParentInputClosure, useParentInputsClosed } from "../data/parentInputClosure";
import {
  questionDraftKey,
  readQuestionDraft,
  reserveQuestionDraft,
  subscribeQuestionDraftCapacity,
  getQuestionDraftCapacitySnapshot,
  type QuestionDraft,
  type QuestionDraftFailure,
  type QuestionDraftReservation,
} from "../model/questionDrafts";
import type { UserQuestionPrompt } from "../model/userQuestion";
export function useQuestionFormDraft(
  prompt: UserQuestionPrompt,
  draftScope?: string,
  parentSessionId?: string,
) {
  const parentScope = parentSessionId ? undefined : "profile";
  const parentClosed = useParentInputsClosed(parentSessionId, parentScope);
  const capacityEpoch = useSyncExternalStore(
    subscribeQuestionDraftCapacity,
    getQuestionDraftCapacitySnapshot,
    getQuestionDraftCapacitySnapshot,
  );
  const reservation = useRef<QuestionDraftReservation | undefined>(undefined);
  const privateMountOwner = useRef({});
  const everReserved = useRef(false);
  const mounted = useRef(false);
  const [reserved, setReserved] = useState(false);
  const [capacityIssue, setCapacityIssue] = useState<QuestionDraftFailure | undefined>(undefined);
  const [draft, setDraft] = useState<QuestionDraft>(
    () =>
      readQuestionDraft(draftScope, prompt) ?? {
        step: 0,
        answers: {},
        custom: {},
      },
  );
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const submitted = useRef(!!draft.delivery);
  const [submitting, setSubmitting] = useState(draft.delivery === "sending");
  const [localUnknown, setLocalUnknown] = useState(draft.delivery === "unknown");
  const form = useRef<HTMLFormElement>(null);
  const parentChanged = useParentInputClosure(
    {
      kind: "question-draft",
      sessionId: parentSessionId,
      scope: parentScope,
      snapshot: () => ({
        source: "mounted-question-form",
        draftScope,
        questionKey: questionDraftKey(draftScope, prompt),
        prompt,
        draft: draftRef.current,
        submitted: submitted.current,
        submitting,
        localUnknown,
        customInputs: Array.from(
          form.current?.querySelectorAll("textarea") ?? [],
          (field) => field.value,
        ),
        optionInputs: Array.from(
          form.current?.querySelectorAll<HTMLInputElement>("input") ?? [],
          (field) => ({ value: field.value, checked: field.checked }),
        ),
      }),
    },
    form,
  );
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reservation.current?.release();
      reservation.current = undefined;
      everReserved.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const current = reservation.current;
    if (current) {
      if (!current.current()) {
        setReserved(false);
        setCapacityIssue("retired");
        return;
      }
      const refreshed = current.refresh(prompt);
      if (!refreshed.ok) {
        setReserved(false);
        setCapacityIssue(refreshed.reason);
        return;
      }
      setReserved(true);
      return;
    }
    if (everReserved.current) return;
    const result = reserveQuestionDraft(
      draftScope,
      prompt,
      parentSessionId,
      privateMountOwner.current,
    );
    if (!result.ok) {
      setReserved(false);
      setCapacityIssue(result.reason);
      return;
    }
    reservation.current = result.value;
    everReserved.current = true;
    const retained = result.value.read();
    if (retained) {
      draftRef.current = retained;
      setDraft(retained);
      submitted.current = !!retained.delivery;
      setSubmitting(retained.delivery === "sending");
      setLocalUnknown(retained.delivery === "unknown");
    }
    setReserved(true);
    setCapacityIssue(undefined);
  }, [draftScope, prompt, parentSessionId, capacityEpoch]);
  const persistDraft = (next: QuestionDraft, external = false) => {
    const result = reservation.current?.write(next, external);
    if (!result?.ok) {
      if (mounted.current) setCapacityIssue(result?.reason ?? "retired");
      return false;
    }
    draftRef.current = result.value;
    if (mounted.current) {
      setDraft(result.value);
      setCapacityIssue(undefined);
      parentChanged();
    }
    return true;
  };
  const updateDraft = (update: (current: QuestionDraft) => QuestionDraft) => {
    if (!mounted.current || !reservation.current?.current() || !parentChanged.canMutate())
      return false;
    return persistDraft(update(draftRef.current));
  };

  useEffect(() => {
    if (prompt.delivery === "failed") {
      const current = draftRef.current;
      if (
        current.delivery &&
        !persistDraft({ ...current, delivery: undefined, pendingAction: undefined }, true)
      )
        return;
      submitted.current = false;
      setSubmitting(false);
      setLocalUnknown(false);
    } else if (prompt.delivery === "unknown" || prompt.delivery === "queued") {
      setSubmitting(false);
    }
  }, [prompt, reserved]);

  return {
    draft,
    draftRef,
    setDraft,
    submitted,
    submitting,
    setSubmitting,
    localUnknown,
    setLocalUnknown,
    form,
    parentClosed,
    parentChanged,
    reserved,
    reservation,
    mounted,
    capacityIssue,
    persistDraft,
    updateDraft,
  };
}
