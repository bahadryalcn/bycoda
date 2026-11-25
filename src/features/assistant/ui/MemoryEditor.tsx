import { describeRemoteError } from "../../connections/public/remoteFailure";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useId, useRef, useState } from "react";
import type { AssistantMemory } from "../../../shared/model/host-contracts/assistant";
import { assistantRequest } from "../model/assistantClient";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { InlineError } from "../../../shared/ui/InlineError";
import styles from "./AssistantMemoryPanel.module.css";
type OwnerRequest = typeof assistantRequest;

export function MemoryEditor({
  request,
  entry,
  onClose,
}: {
  request: OwnerRequest;
  entry: AssistantMemory | "new";
  onClose: () => void;
}) {
  const [assistantRequest] = useState(() => request);
  const [original, setOriginal] = useState(entry === "new" ? null : entry);
  const [text, setText] = useState(original?.text ?? "");
  const [kind, setKind] = useState<AssistantMemory["kind"]>(original?.kind ?? "rule");
  const [scope, setScope] = useState<AssistantMemory["scope"]>(original?.scope ?? "all");
  const [terms, setTerms] = useState(original?.forbiddenTerms.join(", ") ?? "");
  const currentDraft = useRef({ text, kind, scope, terms });
  currentDraft.current = { text, kind, scope, terms };
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<{ message: string; details?: string } | null>(null);
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      const result = await assistantRequest({
        op: "memory.save",
        ...(original ? { id: original.id, expectedVersion: original.version } : {}),
        kind,
        text,
        scope,
        source: "typed",
        quote: text,
        active: original?.active ?? true,
        forbiddenTerms: terms
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean),
      });
      if (!result.memory)
        throw new Error(t("The memory save could not be confirmed. Keep this draft and retry."));
      setOriginal(result.memory);
      const current = currentDraft.current;
      if (
        current.text === text &&
        current.kind === kind &&
        current.scope === scope &&
        current.terms === terms
      )
        onClose();
    } catch (cause) {
      setProblem(describeRemoteError(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={original ? t("Edit memory") : t("Add memory")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      fitViewport
      footerStart={
        problem ? <InlineError details={problem.details}>{problem.message}</InlineError> : undefined
      }
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            disabled={!text.trim()}
          >
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className={styles.editor}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextareaField
          label={t("Memory")}
          value={text}
          required
          maxLength={4000}
          minRows={4}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <div className={styles.editorOptions}>
          <Select
            label={t("Kind")}
            value={kind}
            options={[
              { value: "rule", label: t("Rules") },
              { value: "profile", label: t("About me") },
              { value: "fact", label: t("Learned") },
            ]}
            onValueChange={(value) => setKind(value as typeof kind)}
          />
          <Select
            label={t("Scope")}
            value={scope}
            options={[
              { value: "all", label: t("Everywhere") },
              { value: "voice", label: t("Voice only") },
              { value: "sessions", label: t("Coding sessions only") },
            ]}
            onValueChange={(value) => setScope(value as typeof scope)}
          />
        </div>
        <Disclosure
          summary={t("Forbidden words")}
          defaultOpen={Boolean(original?.forbiddenTerms.length)}
          tone="secondary"
        >
          <TextField
            label={t("Forbidden words")}
            hideLabel
            description={t(
              "Optional, separated by commas. Text outputs are checked before delivery.",
            )}
            value={terms}
            onChange={(event) => setTerms(event.currentTarget.value)}
          />
        </Disclosure>
      </form>
    </Modal>
  );
}
