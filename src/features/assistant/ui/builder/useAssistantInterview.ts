import { useRef, useState } from "react";
import { getLocale } from "../../../../shared/i18n";
import type {
  AssistantBuilderTurn,
  AssistantProfileInterviewResult,
} from "../../../../shared/model/host-contracts/assistant-builder";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { appendBuilderTurn, proposalFromDraft } from "../../model/assistantBuilder";
import {
  interviewFirstQuestion,
  resolveInterviewLanguage,
} from "../../model/assistantInterviewLanguage";
import {
  assistantBuilderFailureDetail,
  requestAssistantInterview,
  type AssistantInterviewParams,
} from "../../model/assistantBuilderClient";

export type InterviewProposal = Extract<AssistantProfileInterviewResult, { kind: "proposal" }>;

export type InterviewModel = {
  harness: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
};

/**
 * The interview transcript and its one in-flight Host request. Only the newest request may change
 * state, so a result that lands after Back, Cancel or a newer request is dropped.
 */
export function useAssistantInterview(model: InterviewModel, draft: AssistantProfilePatch) {
  const [language, setInterviewLanguage] = useState(() =>
    resolveInterviewLanguage(draft.language, getLocale()),
  );
  const [transcript, setTranscript] = useState<AssistantBuilderTurn[]>(() => [
    { role: "assistant", text: interviewFirstQuestion(language) },
  ]);
  const [options, setOptions] = useState<string[]>([]);
  const [proposal, setProposal] = useState<InterviewProposal | null>(null);
  const [busy, setBusy] = useState(false);
  /** `null` while nothing failed; "" when the Host gave no reason. */
  const [failure, setFailure] = useState<string | null>(null);
  const epoch = useRef(0);
  const retryRef = useRef<{ next: AssistantBuilderTurn[]; finish: boolean } | null>(null);

  function run(next: AssistantBuilderTurn[], finish: boolean, requestLanguage = language) {
    const mine = ++epoch.current;
    retryRef.current = { next, finish };
    setTranscript(next);
    setOptions([]);
    setBusy(true);
    setFailure(null);
    const params: AssistantInterviewParams = {
      harness: model.harness as AssistantInterviewParams["harness"],
      model: model.model,
      ...(model.modelSettings && Object.keys(model.modelSettings).length > 0
        ? { modelSettings: model.modelSettings }
        : {}),
      ...(model.providerAccountId ? { providerAccountId: model.providerAccountId } : {}),
      locale: requestLanguage,
      current: proposalFromDraft(draft),
      transcript: next,
      ...(finish ? { finish: true } : {}),
    };
    requestAssistantInterview(params)
      .then((result) => {
        if (mine !== epoch.current) return;
        if (result.kind === "question") {
          setTranscript(appendBuilderTurn(next, { role: "assistant", text: result.question }));
          setOptions(result.options);
        } else setProposal(result);
      })
      .catch((error: unknown) => {
        if (mine === epoch.current) setFailure(assistantBuilderFailureDetail(error));
      })
      .finally(() => {
        if (mine === epoch.current) setBusy(false);
      });
  }

  return {
    language,
    setLanguage: (value: string) => {
      const nextLanguage = resolveInterviewLanguage(value, getLocale());
      if (nextLanguage === language) return;
      setInterviewLanguage(nextLanguage);
      setProposal(null);
      // The current question can be replaced; previous questions and every owner answer stay intact.
      let lastAnswer = transcript.length - 1;
      while (lastAnswer >= 0 && transcript[lastAnswer]?.role !== "owner") lastAnswer -= 1;
      if (lastAnswer >= 0) run(transcript.slice(0, lastAnswer + 1), false, nextLanguage);
      else {
        epoch.current += 1;
        retryRef.current = null;
        setTranscript([{ role: "assistant", text: interviewFirstQuestion(nextLanguage) }]);
        setOptions([]);
        setBusy(false);
        setFailure(null);
      }
    },
    transcript,
    options,
    proposal,
    busy,
    failure,
    /** First question, from the draft alone. */
    begin: () => run([], false),
    answer: (text: string) => run(appendBuilderTurn(transcript, { role: "owner", text }), false),
    /** Stops answering: any text typed so far counts as a last answer. */
    finish: (text = "") => run(appendBuilderTurn(transcript, { role: "owner", text }), true),
    retry: () => {
      const retry = retryRef.current;
      if (retry) run(retry.next, retry.finish);
    },
    /** Drops an in-flight request without losing the transcript. */
    cancel: () => {
      epoch.current += 1;
      setBusy(false);
      setFailure(null);
    },
    /** Back from the preview to more questions. */
    reopen: () => setProposal(null),
  };
}
