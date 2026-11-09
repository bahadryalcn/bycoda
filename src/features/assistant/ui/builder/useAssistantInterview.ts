import { useRef, useState } from "react";
import { getLocale } from "../../../../shared/i18n";
import type {
  AssistantBuilderTurn,
  AssistantProfileInterviewResult,
} from "../../../../shared/model/host-contracts/assistant-builder";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { appendBuilderTurn, proposalFromDraft } from "../../model/assistantBuilder";
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
  const [transcript, setTranscript] = useState<AssistantBuilderTurn[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [proposal, setProposal] = useState<InterviewProposal | null>(null);
  const [busy, setBusy] = useState(false);
  /** `null` while nothing failed; "" when the Host gave no reason. */
  const [failure, setFailure] = useState<string | null>(null);
  const epoch = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);

  function run(next: AssistantBuilderTurn[], finish: boolean) {
    const mine = ++epoch.current;
    retryRef.current = () => run(next, finish);
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
      locale: getLocale(),
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
    retry: () => retryRef.current?.(),
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
