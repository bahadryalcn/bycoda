import { useId, useState } from "react";
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
  const original = entry === "new" ? null : entry;
  const [text, setText] = useState(original?.text ?? "");
  const [kind, setKind] = useState<AssistantMemory["kind"]>(original?.kind ?? "rule");
  const [scope, setScope] = useState<AssistantMemory["scope"]>(original?.scope ?? "all");
  const [terms, setTerms] = useState(original?.forbiddenTerms.join(", ") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const formId = useId();
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await assistantRequest({
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
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title={t(original ? "Edit memory" : "Add memory")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      fitViewport
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
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
            visibleLabel
            label={t("Kind")}
            value={kind}
            options={[
              ["rule", "Rules"],
              ["profile", "About me"],
              ["fact", "Learned"],
            ].map(([value, label]) => ({ value, label: t(label) }))}
            onValueChange={(value) => setKind(value as typeof kind)}
          />
          <Select
            visibleLabel
            label={t("Scope")}
            value={scope}
            options={[
              ["all", "Everywhere"],
              ["voice", "Voice only"],
              ["sessions", "Coding sessions only"],
            ].map(([value, label]) => ({ value, label: t(label) }))}
            onValueChange={(value) => setScope(value as typeof scope)}
          />
        </div>
        <TextField
          label={t("Forbidden words")}
          description={t(
            "Optional, separated by commas. Text outputs are checked before delivery.",
          )}
          value={terms}
          onChange={(event) => setTerms(event.currentTarget.value)}
        />
      </form>
    </Modal>
  );
}
