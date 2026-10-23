import { Button } from "../../../shared/ui/Button";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t, useLocale } from "../../../shared/i18n/git";
import { Modal } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { Loader, WandSparkles, X } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { generateCommitMessage } from "../../../integrations/harness";
import { MOD } from "../../../platform/tauri/platform";

type Busy = "stash" | "commit" | null;

type Props = {
  cwd: string;
  branch: string;
  creating?: boolean;
  busy: Busy;
  error?: string | null;
  onStash: () => void;
  onCommit: (message: string) => void;
  onCancel: () => void;
};

export function SwitchBranchDialog({
  cwd,
  branch,
  creating = false,
  busy,
  error,
  onStash,
  onCommit,
  onCancel,
}: Props) {
  useLocale();
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = message.trim();
  const canCommit = trimmed.length > 0 && !busy && !generating;

  useEffect(() => {
    messageRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (generateAbortRef.current) {
        generateAbortRef.current.abort();
        generateAbortRef.current = null;
        setGenerating(false);
      }
    },
    [cwd],
  );

  useEffect(() => {
    const el = messageRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message]);

  const generate = async () => {
    if (busy || generating || generateAbortRef.current) return;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setGenerating(true);
    setGenerateError(null);
    try {
      const generated = await generateCommitMessage(cwd, undefined, controller.signal);
      if (!controller.signal.aborted) setMessage(generated);
    } catch (err) {
      if (!controller.signal.aborted) {
        setGenerateError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        setGenerating(false);
        messageRef.current?.focus();
      }
    }
  };

  const cancelGenerate = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setGenerating(false);
    messageRef.current?.focus();
  };

  const description = creating
    ? t(
        "Creating “{p0}” would overwrite your local changes. Stash them for later, or commit them on this branch first.",
        { p0: branch },
      )
    : t(
        "Switching to “{p0}” would overwrite your local changes. Stash them for later, or commit them on this branch first.",
        { p0: branch },
      );

  return (
    <Modal
      size="sm"
      title={t("Uncommitted changes")}
      description={description}
      onClose={() => {
        if (!busy && !generating) onCancel();
      }}
    >
      <div aria-busy={Boolean(busy) || generating} className="flex flex-col gap-3 px-4 pt-2 pb-4">
        <div className="relative">
          <TextareaField
            hideLabel
            label=""
            ref={messageRef}
            style={{ minHeight: 0 }}
            rows={1}
            value={message}
            placeholder={t("Message ({p0}↩ to commit)", { p0: MOD })}
            disabled={Boolean(busy) || generating}
            aria-label={t("Commit message")}
            className="max-h-40 w-full resize-none overflow-y-auto leading-5 pe-8"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
                event.preventDefault();
                onCommit(trimmed);
              }
            }}
          />
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            motion="none"
            type="button"
            label={
              generating ? t("Cancel commit message generation") : t("Generate commit message")
            }
            tooltip={
              generating ? t("Cancel commit message generation") : t("Generate commit message")
            }
            disabled={Boolean(busy)}
            onClick={() => (generating ? cancelGenerate() : void generate())}
            className="group absolute top-1 right-1"
          >
            {generating ? (
              <>
                <Loader
                  className="icon-sm animate-spin group-hover:hidden group-focus-visible:hidden"
                  strokeWidth={1.75}
                />
                <X
                  className="icon-sm hidden group-hover:block group-focus-visible:block"
                  strokeWidth={1.75}
                />
              </>
            ) : (
              <WandSparkles className="icon-sm" strokeWidth={1.75} />
            )}
          </Button>
        </div>

        {generateError ? <Alert tone="danger">{generateError}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={Boolean(busy) || generating}
            onClick={onCancel}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="secondary"
            motion="none"
            type="button"
            disabled={!canCommit}
            onClick={() => onCommit(trimmed)}
            className="inline-flex items-center gap-1.5"
          >
            {busy === "commit" ? (
              <Loader className="icon-sm animate-spin" strokeWidth={1.75} />
            ) : null}
            {t("Commit & switch")}
          </Button>
          <Button
            variant="primary"
            motion="none"
            type="button"
            disabled={Boolean(busy) || generating}
            onClick={onStash}
            className="inline-flex items-center gap-1.5"
          >
            {busy === "stash" ? (
              <Loader className="icon-sm animate-spin" strokeWidth={1.75} />
            ) : null}
            {t("Stash & switch")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
