import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT, formatDate } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import {
  readQuestionDraft,
  writeQuestionDraft,
  resolveQuestionDraft,
  subscribeQuestionDraftCapacity,
} from "../../sessions/model/questionDrafts";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type { AssistantOwnerQuestion } from "../../../shared/model/assistantOwnerQuestions";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import {
  AssistantOwnerQuestionDraft,
  ownerQuestionDraftScope,
  ownerQuestionPrompt,
  ownerQuestionVisible,
  pendingOwnerQuestions,
  type OwnerQuestionPort,
} from "../model/assistantOwnerQuestions";
import styles from "./AssistantOwnerQuestions.module.css";
import {
  pendingOwnerQuestionPresentations,
  retryOwnerQuestionPresentation,
  type OwnerQuestionPresentation,
} from "../model/assistantOwnerQuestionPresentations";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Props = {
  questions: readonly AssistantOwnerQuestion[];
  environmentId: string;
  visibleProjectIds: readonly string[];
  request: (input: AssistantRequest, expectedEnvironmentId?: string) => Promise<AssistantResponse>;
  onChanged?: () => void;
  storage?: Storage;
};
const EVENT = "bycoda:assistant-owner-questions-changed";
/** The same Host question can be presented in Room or Voice; neither presentation owns its answer authority. */
export function AssistantOwnerQuestions(props: Props) {
  const t = useT();
  const [epoch, setEpoch] = useState(0),
    latest = useRef(props);
  latest.current = props;
  const storage = props.storage ?? localStorage;
  const notify = () => {
    setEpoch((value) => value + 1);
    window.dispatchEvent(
      new CustomEvent(EVENT, { detail: { environmentId: props.environmentId } }),
    );
  };
  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.environmentId !== props.environmentId)
        return;
      setEpoch((value) => value + 1);
    };
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [props.environmentId]);
  const questions = useMemo(() => {
    const byId = new Map(props.questions.map((question) => [question.id, question]));
    for (const pending of pendingOwnerQuestions(storage, props.environmentId))
      byId.set(pending.id, pending);
    return [...byId.values()].filter(
      (question) =>
        ownerQuestionVisible(question, props.visibleProjectIds) &&
        (["open", "snoozed"].includes(question.status) ||
          pendingOwnerQuestions(storage, props.environmentId).some(
            (pending) => pending.id === question.id,
          )),
    );
  }, [props.questions, props.environmentId, props.visibleProjectIds, storage, epoch]);
  const presentations = pendingOwnerQuestionPresentations(storage, props.environmentId).filter(
    (value) => value.input.contextProjectIds.every((id) => props.visibleProjectIds.includes(id)),
  );
  if (!questions.length && !presentations.length) return null;
  return (
    <div className={styles.questions} aria-label={t("Questions waiting for you")}>
      {presentations.map((value) => (
        <PendingPresentation
          key={JSON.stringify([value.environmentId, value.input.threadId, value.input.requestId])}
          value={value}
          storage={storage}
          request={props.request}
          notify={notify}
          onChanged={props.onChanged}
          authorized={(ids) =>
            latest.current.environmentId === props.environmentId &&
            ids.every((id) => latest.current.visibleProjectIds.includes(id))
          }
        />
      ))}
      {questions.map((question) => (
        <OwnerQuestionCard
          key={ownerQuestionDraftScope(props.environmentId, question)}
          question={question}
          current={props.questions.find((value) => value.id === question.id)}
          environmentId={props.environmentId}
          storage={storage}
          epoch={epoch}
          request={props.request}
          notify={notify}
          onChanged={props.onChanged}
          authorized={() =>
            latest.current.environmentId === props.environmentId &&
            ownerQuestionVisible(question, latest.current.visibleProjectIds)
          }
        />
      ))}
    </div>
  );
}
function PendingPresentation({
  value,
  storage,
  request,
  notify,
  onChanged,
  authorized,
}: {
  value: OwnerQuestionPresentation;
  storage: Storage;
  request: Props["request"];
  notify: () => void;
  onChanged?: () => void;
  authorized: (ids: readonly string[]) => boolean;
}) {
  const t = useT(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const checking = useRef(false),
    guard = useRef(authorized);
  guard.current = authorized;
  const retry = async () => {
    if (checking.current) return;
    checking.current = true;
    setPending(true);
    setError("");
    try {
      await retryOwnerQuestionPresentation(value, storage, request, (ids) => guard.current(ids));
      notify();
      onChanged?.();
    } catch {
      setError(t("Saving this question is unconfirmed. Retry to verify the original card."));
    } finally {
      checking.current = false;
      setPending(false);
    }
  };
  return (
    <article className={styles.card}>
      <p className={styles.title}>{value.input.title ?? value.input.questions[0].prompt}</p>
      {error ? (
        <InlineError>{error}</InlineError>
      ) : (
        <p className={styles.status}>
          {t("Saving this question is unconfirmed. Retry to verify the original card.")}
        </p>
      )}
      <div className={styles.footer}>
        <Button size="sm" loading={pending} disabled={pending} onClick={() => void retry()}>
          {t("Retry")}
        </Button>
      </div>
    </article>
  );
}
function OwnerQuestionCard({
  question,
  current,
  environmentId,
  storage,
  epoch,
  request,
  notify,
  onChanged,
  authorized,
}: {
  question: AssistantOwnerQuestion;
  current?: AssistantOwnerQuestion;
  environmentId: string;
  storage: Storage;
  epoch: number;
  request: Props["request"];
  notify: () => void;
  onChanged?: () => void;
  authorized: () => boolean;
}) {
  const t = useT();
  const guard = useRef(authorized);
  guard.current = authorized;
  const observer = useRef(notify);
  observer.current = notify;
  const creation = useMemo(() => {
    try {
      return {
        model: new AssistantOwnerQuestionDraft(
          question,
          environmentId,
          storage,
          () => crypto.randomUUID(),
          () => guard.current(),
          () => observer.current(),
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [environmentId, question, storage, epoch]);
  const model = creation.model,
    prompt = useMemo(() => ownerQuestionPrompt(question, t("Type your answer")), [question, t]);
  const [ready, setReady] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [resolved, setResolved] = useState<AssistantOwnerQuestion>(),
    [expanded, setExpanded] = useState(false);
  const alive = useRef(true),
    checking = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    setReady(false);
    if (!model) return;
    const hydrated = writeQuestionDraft(model.scope, prompt, model.formDraft, true);
    if (!hydrated.ok) {
      setError(t("This question draft could not be restored. Keep the original card and retry."));
      return;
    }
    setReady(true);
    return subscribeQuestionDraftCapacity(() => {
      const draft = readQuestionDraft(model.scope, prompt);
      if (!draft) return;
      try {
        model.saveDraft(draft);
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }, [model, prompt]);
  useEffect(() => {
    if (!model || !current || !model.intentPending) return;
    try {
      if (model.observe(current)) {
        resolveQuestionDraft(model.scope, prompt);
        setResolved(current);
        onChanged?.();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [model, current, prompt, onChanged]);
  function complete(value: AssistantOwnerQuestion) {
    if (!model) return;
    resolveQuestionDraft(model.scope, prompt);
    if (alive.current) {
      setResolved(value);
      setError("");
      setPending(false);
    }
    onChanged?.();
  }
  async function act(reply?: UserQuestionReply) {
    if (!model || checking.current) return;
    checking.current = true;
    setPending(true);
    setError("");
    try {
      const port: OwnerQuestionPort = (input, expected) => request(input, expected);
      const value = await (reply
        ? model.submit(reply, port, Date.now() + 60 * 60 * 1000)
        : model.retry(port));
      complete(value);
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
      }
    } finally {
      checking.current = false;
    }
  }
  async function refresh() {
    if (checking.current) return;
    checking.current = true;
    setPending(true);
    setError("");
    try {
      if (!guard.current()) return;
      const result = await request({ op: "questions.get", id: question.id }, environmentId);
      if (!guard.current()) return;
      if (!result.ownerQuestion)
        throw new Error(
          "The question is no longer available. Keep this draft and review its original work.",
        );
      onChanged?.();
      if (
        alive.current &&
        ["answered", "cancelled", "superseded"].includes(result.ownerQuestion.status)
      )
        setResolved(result.ownerQuestion);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      checking.current = false;
      if (alive.current) setPending(false);
    }
  }
  const value = resolved ?? question,
    held = !!model?.intentPending;
  if (!creation.model)
    return (
      <article className={styles.card}>
        <p className={styles.title}>{question.prompt.title ?? t("Question")}</p>
        <InlineError>
          {t(
            creation.error ??
              "This question draft could not be restored. Keep the original card and retry.",
          )}
        </InlineError>
        <Button size="sm" onClick={notify}>
          {t("Retry")}
        </Button>
      </article>
    );
  if (!held && ["answered", "cancelled", "superseded"].includes(value.status)) return null;
  const snoozed = !held && value.status === "snoozed" && !expanded;
  const stale = value.sourceCurrent === false;
  return (
    <article
      className={styles.card}
      data-question-form={(ready && !snoozed && !stale) || undefined}
      aria-label={question.prompt.title ?? t("Question")}
    >
      {snoozed || stale ? (
        <>
          <p className={styles.title}>
            {question.prompt.title ?? question.prompt.questions[0].prompt}
          </p>
          <p className={styles.status}>
            {stale
              ? t("This question changed with its work. Refresh it before answering.")
              : t("Snoozed until {p0}", {
                  p0: formatDate(value.snoozedUntil ?? value.updatedAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                })}
          </p>
          <div className={styles.footer}>
            <Button
              size="sm"
              loading={pending}
              disabled={pending}
              onClick={stale ? () => void refresh() : () => setExpanded(true)}
            >
              {t(stale ? "Refresh" : "Answer now")}
            </Button>
          </div>
        </>
      ) : ready ? (
        <QuestionForm
          prompt={{
            ...prompt,
            ...(pending
              ? { delivery: "sending" as const }
              : held
                ? { delivery: "unknown" as const }
                : error
                  ? { delivery: "failed" as const }
                  : {}),
            ...(error ? { error: t(error) } : {}),
          }}
          draftScope={model!.scope}
          dismissLabel={t("Later")}
          dismissEntirePrompt
          onReply={(_id, reply) => {
            void act(reply);
          }}
        />
      ) : (
        <p className={styles.status}>{t("Loading...")}</p>
      )}
      {error && (!ready || snoozed || stale) ? <InlineError>{t(error)}</InlineError> : null}
      {!ready && error ? (
        <Button size="sm" onClick={notify}>
          {t("Retry")}
        </Button>
      ) : null}
      {held && !pending ? (
        <div className={styles.footer}>
          <Button size="sm" onClick={() => void act()}>
            {t("Retry")}
          </Button>
          <p className={styles.status}>
            {t("The answer is unconfirmed. Your original choice is kept.")}
          </p>
        </div>
      ) : null}
    </article>
  );
}
