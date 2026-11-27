import { presentRemoteError } from "../../connections/public/remoteFailure";
import { Button } from "../../../shared/ui/Button";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { t, useLocale } from "../../../shared/i18n/git";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Text } from "../../../shared/ui/Text";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { WandSparkles, X } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { generateCommitMessage } from "../model/gitTextGeneration";

type Busy = "stash" | "commit" | null;

type Props = {
  cwd: string;
  branch: string;
  creating?: boolean;
  busy: Busy;
  error?: string | null;
  /** Files git says the switch would overwrite; empty when it named none. */
  files?: readonly string[];
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
  files = [],
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
        setGenerateError(presentRemoteError(err, { explicit: true }));
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
      footer={
        <ModalActions>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={Boolean(busy) || generating}
            disabledReason={
              busy
                ? t("Wait for the current operation to finish")
                : generating
                  ? t("Generating message…")
                  : undefined
            }
            onClick={onCancel}
          >
            {t("Cancel")}
          </Button>
          {/* Emphasis stays on Stash & switch: it must not move under the pointer as the user types. */}
          <Button
            variant="secondary"
            motion="none"
            type="button"
            loading={busy === "commit"}
            shortcut="Mod+Enter"
            disabled={!canCommit}
            disabledReason={
              !trimmed && !busy && !generating
                ? t("Write a commit message to commit and switch")
                : undefined
            }
            onClick={() => onCommit(trimmed)}
          >
            {t("Commit & switch")}
          </Button>
          <Button
            variant="primary"
            motion="none"
            type="button"
            loading={busy === "stash"}
            disabled={Boolean(busy) || generating}
            disabledReason={
              busy
                ? t("Wait for the current operation to finish")
                : generating
                  ? t("Generating message…")
                  : undefined
            }
            onClick={onStash}
          >
            {t("Stash & switch")}
          </Button>
        </ModalActions>
      }
    >
      <div aria-busy={Boolean(busy) || generating} className="flex flex-col gap-3">
        {files.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-1">
            <Text
              as="div"
              size="micro"
              tone="muted"
              leading="tight"
              className="max-h-32 overflow-y-auto"
            >
              {files.map((file) => (
                <p key={file} className="font-mono break-all">
                  {file}
                </p>
              ))}
            </Text>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <TextareaField
            hideLabel
            label=""
            ref={messageRef}
            autosize
            minRows={1}
            maxRows={8}
            value={message}
            placeholder={t("Commit message")}
            disabled={Boolean(busy) || generating}
            aria-label={t("Commit message")}
            className="w-full"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
                event.preventDefault();
                onCommit(trimmed);
              }
            }}
          />
          <div className="flex items-center justify-end gap-1">
            {generating ? <WorkingIndicator label={t("Working")} /> : null}
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              motion="none"
              type="button"
              label={
                generating ? t("Stop commit message generation") : t("Generate commit message")
              }
              disabled={Boolean(busy)}
              disabledReason={busy ? t("Wait for the current operation to finish") : undefined}
              onClick={() => (generating ? cancelGenerate() : void generate())}
              className="self-end"
            >
              {generating ? (
                <X className="icon-sm" strokeWidth={1.75} />
              ) : (
                <WandSparkles className="icon-sm" strokeWidth={1.75} />
              )}
            </Button>
          </div>
        </div>

        {generateError ? (
          <Alert
            tone="danger"
            title={t("Couldn’t generate a commit message")}
            extra={<ErrorDetails detail={generateError} />}
          />
        ) : null}
        {error ? (
          <Alert
            tone="danger"
            title={t("Couldn’t switch branch")}
            extra={<ErrorDetails detail={error} />}
          />
        ) : null}
      </div>
    </Modal>
  );
}
