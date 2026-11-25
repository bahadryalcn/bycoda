import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Text } from "../../../shared/ui/Text";
import { SettingsFeedback } from "../../../shared/ui/settings";

import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { ExternalLink, FolderOpen, Pencil, RefreshCw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Badge } from "../../../shared/ui/Badge";
import { Modal, ModalActions, ModalFooter } from "../../../shared/ui/Modal";

import {
  inspectHarnessBinary,
  type HarnessBinaryInspection,
} from "../../../integrations/harness/core/child";
import {
  loadProviderBinaryPath,
  providerBinaryPathChangePending,
  saveProviderBinaryPath,
  type ConfigurableBinaryProvider,
} from "../../providers/model/providerBinaryPaths";
import {
  compareSemver,
  MINIMUM_OPENCODE_VERSION,
  parseOpenCodeVersion,
} from "../../../integrations/harness/providers/opencode/opencodeProtocol";
import { errorText } from "../../../shared/lib/errors";

import { revealPath } from "../../../platform/tauri/fs";
import { open as pickFile } from "@tauri-apps/plugin-dialog";

import { HARNESS_TITLE } from "../../sessions";

export const GLOBAL_PROVIDER_SCOPE = "global";

export function binaryInspectionError(
  provider: ConfigurableBinaryProvider,
  inspection: HarnessBinaryInspection,
): string | null {
  if (inspection.error) return inspection.error;
  if (provider === "codex" && !/^codex-cli\s+\d+\.\d+\.\d+/.test(inspection.version ?? "")) {
    return t("Codex CLI returned an invalid version.");
  }
  if (provider === "opencode") {
    const version = parseOpenCodeVersion(inspection.version ?? "");
    if (!version) return t("OpenCode CLI returned an invalid version.");
    if (compareSemver(version, MINIMUM_OPENCODE_VERSION) < 0) {
      return t("OpenCode v{p0} is too old. Upgrade to v{p1} or newer.", {
        p0: version,
        p1: MINIMUM_OPENCODE_VERSION,
      });
    }
  }
  return null;
}

export function ProviderBinaryControl({
  provider,
  showLabel = false,
  missing = false,
  onPathSaved,
  inline = false,
  onCancel,
  triggerVariant = "ghost",
}: {
  provider: ConfigurableBinaryProvider;
  /** Look of the trigger button; a settings row uses `secondary`. */
  triggerVariant?: "ghost" | "secondary";
  showLabel?: boolean;
  /** Missing CLIs use the setup action label in the inventory. */
  missing?: boolean;
  onPathSaved?: () => void;
  /** Embed the existing validated path form in an add-provider dialog. Fixed for the mounted control. */
  inline?: boolean;
  onCancel?: () => void;
}) {
  useLocale();
  const root = useRef<HTMLSpanElement>(null);
  const formId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(inline);
  const [draft, setDraft] = useState(() => loadProviderBinaryPath(provider) ?? "");
  const [overridden, setOverridden] = useState(() => Boolean(loadProviderBinaryPath(provider)));
  const [inspection, setInspection] = useState<HarnessBinaryInspection & { overridden: boolean }>();
  const [operation, setOperation] = useState<"inspect" | "save" | "auto" | "choose" | null>(null);
  const working = operation !== null;
  const inspectionBusy = useRef(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  // Callers key this control by provider, so every provider starts from fresh state.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);

  const inspect = useCallback(
    async (binaryPath?: string | null, action: "inspect" | "save" | "auto" = "inspect") => {
      if (inspectionBusy.current) return null;
      const generation = ++request.current;
      inspectionBusy.current = true;
      setOperation(action);
      setInspection(undefined);
      setError(null);
      setRevealError(null);
      try {
        const next = await inspectHarnessBinary(provider, binaryPath);
        if (!mounted.current || generation !== request.current) return null;
        setInspection({
          ...next,
          overridden: Boolean(binaryPath?.trim()),
        });
        const problem = binaryInspectionError(provider, next);
        setError(
          problem
            ? {
                title: next.error ? t("Could not inspect the CLI executable.") : problem,
                detail: next.error || undefined,
              }
            : null,
        );
        return next;
      } catch (cause) {
        if (!mounted.current || generation !== request.current) return null;
        setError({ title: t("Could not inspect the CLI executable."), detail: errorText(cause) });
        return null;
      } finally {
        if (generation === request.current) {
          inspectionBusy.current = false;
          setOperation(null);
        }
      }
    },
    [provider],
  );

  useEffect(() => {
    if (editing) editInput.current?.focus();
  }, [editing]);

  const dismiss = (restoreFocus = false) => {
    request.current += 1;
    inspectionBusy.current = false;
    setOperation(null);
    setOpen(false);
    setEditing(false);
    if (restoreFocus) queueMicrotask(() => trigger.current?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    const value = draft.trim();
    if (!value) {
      if (inline) return;
      await useAuto();
      return;
    }
    const generation = request.current + 1;
    const next = await inspect(value, "save");
    if (!mounted.current || generation !== request.current || !next) return;
    if (binaryInspectionError(provider, next)) return;
    if (!saveProviderBinaryPath(provider, value)) {
      setInspection(undefined);
      setError({ title: t("Could not save the binary path.") });
      return;
    }
    setOverridden(true);
    dismiss(true);
    onPathSaved?.();
  };

  const useAuto = async () => {
    if (working) return;
    const generation = request.current + 1;
    const next = await inspect(null, "auto");
    if (
      !mounted.current ||
      generation !== request.current ||
      !next ||
      binaryInspectionError(provider, next)
    )
      return;
    if (!saveProviderBinaryPath(provider, null)) {
      setInspection(undefined);
      setError({ title: t("Could not save the binary path.") });
      return;
    }
    setDraft("");
    setOverridden(false);
    dismiss(true);
    onPathSaved?.();
  };

  const title = HARNESS_TITLE[provider];
  const restartRequired = providerBinaryPathChangePending(provider);
  const chooseExecutable = (
    <Button
      className="shrink-0"
      loading={operation === "choose"}
      disabled={working}
      onClick={() => {
        if (inspectionBusy.current) return;
        const generation = ++request.current;
        inspectionBusy.current = true;
        setOperation("choose");
        void pickFile({
          directory: false,
          multiple: false,
          title: t("Choose {p0} executable", { p0: title }),
        })
          .then((path) => {
            if (mounted.current && generation === request.current && typeof path === "string") {
              setDraft(path);
              setError(null);
            }
          })
          .catch((cause) => {
            if (mounted.current && generation === request.current)
              setError({
                title: t("Could not choose the CLI executable."),
                detail: errorText(cause),
              });
          })
          .finally(() => {
            if (generation === request.current) {
              inspectionBusy.current = false;
              setOperation(null);
            }
          });
      }}
    >
      <FolderOpen className="icon-sm" />
      {t("Choose executable")}
    </Button>
  );
  const pathActions = (
    <ModalActions start={!inline ? chooseExecutable : undefined}>
      <Button
        className="shrink-0"
        disabled={working}
        onClick={() => {
          if (inline) {
            onCancel?.();
            return;
          }
          setDraft(loadProviderBinaryPath(provider) ?? "");
          setEditing(false);
          queueMicrotask(() => trigger.current?.focus());
        }}
      >
        {t("Cancel")}
      </Button>
      {overridden ? (
        <Button
          className="shrink-0"
          loading={operation === "auto"}
          disabled={working}
          onClick={() => void useAuto()}
        >
          {t("Use auto-detected path")}
        </Button>
      ) : null}
      <Button
        variant={inline ? "primary" : "secondary"}
        type="submit"
        form={formId}
        loading={operation === "save"}
        disabled={working || (inline && !draft.trim())}
      >
        {working ? t("Checking path…") : inline ? t("Add provider") : t("Save path")}
      </Button>
    </ModalActions>
  );
  const pathForm = (
    <form id={formId} className="grid gap-2" onSubmit={submit}>
      <TextField
        label={t("CLI path")}
        id={`${provider}-binary-path`}
        ref={editInput}
        type="text"
        value={draft}
        placeholder={inspection?.path ?? t("Auto-detected path")}
        description={t(
          "Enter the absolute path to the CLI executable. Changes apply after restarting {p0}.",
          {
            p0: PRODUCT_IDENTITY.displayName,
          },
        )}
        disabled={working}
        autoFocus
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
      />
      {inline ? chooseExecutable : null}
      {error ? (
        <SettingsFeedback
          state="error"
          extra={error.detail ? <ErrorDetails detail={error.detail} /> : undefined}
        >
          {error.title}
        </SettingsFeedback>
      ) : null}
      {inline ? <ModalFooter>{pathActions}</ModalFooter> : null}
    </form>
  );
  if (inline) return pathForm;

  return (
    <span ref={root} className="inline-flex align-middle">
      <Button
        variant={triggerVariant}
        size="sm"
        iconOnly={!showLabel}
        label={
          restartRequired
            ? t("Show {p0} CLI details, restart required", { p0: title })
            : t("Show {p0} CLI details", { p0: title })
        }
        ref={trigger}
        type="button"
        aria-label={
          restartRequired
            ? t("Show {p0} CLI details, restart required", { p0: title })
            : t("Show {p0} CLI details", { p0: title })
        }
        aria-expanded={open}
        aria-controls={`${provider}-binary-popover`}
        aria-haspopup="dialog"
        tooltip={t(restartRequired ? "{p0} CLI path (restart required)" : "{p0} CLI path", {
          p0: title,
        })}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          if (!open && !inspection && !working && !error) {
            void inspect(loadProviderBinaryPath(provider));
          }
          setOpen((value) => !value);
          setEditing(false);
        }}
      >
        <FolderOpen className="icon-sm" strokeWidth={1.75} />
        {showLabel
          ? t(missing ? (provider === "acp" ? "Add provider" : "Set up") : "CLI setup")
          : null}
      </Button>
      {open ? (
        <Modal
          size="sm"
          title={t("{p0} CLI details", { p0: title })}
          onClose={() => dismiss(true)}
          footer={editing ? pathActions : undefined}
        >
          <div className="grid gap-2" aria-busy={working} id={`${provider}-binary-popover`}>
            {restartRequired ? (
              <Badge size="sm" tone="warning">
                {t("Restart required")}
              </Badge>
            ) : null}
            {editing ? (
              pathForm
            ) : (
              <>
                {inspection ? (
                  <OutputBlock frame="filled">
                    {[inspection.path, inspection.version].filter(Boolean).join("\n")}
                  </OutputBlock>
                ) : !error ? (
                  <Text size="caption" tone="secondary">
                    {t("Checking the selected CLI…")}
                  </Text>
                ) : null}
                {error ? (
                  <SettingsFeedback
                    state="error"
                    extra={error.detail ? <ErrorDetails detail={error.detail} /> : undefined}
                  >
                    {error.title}
                  </SettingsFeedback>
                ) : null}
                {revealError ? (
                  <SettingsFeedback state="error" extra={<ErrorDetails detail={revealError} />}>
                    {t("Could not open the CLI location.")}
                  </SettingsFeedback>
                ) : null}
                <ModalActions>
                  {error ? (
                    <Button
                      className="shrink-0"
                      disabled={working}
                      aria-label={t(
                        overridden ? "Retry {p0} configured path" : "Retry {p0} auto-detect",
                        { p0: title },
                      )}
                      onClick={() => void inspect(overridden ? draft.trim() || null : null)}
                    >
                      <RefreshCw className="icon-sm" strokeWidth={1.75} />
                      {overridden ? t("Retry configured path") : t("Retry auto-detect")}
                    </Button>
                  ) : null}
                  <Button
                    className="shrink-0"
                    aria-label={t("Open {p0} CLI location", { p0: title })}
                    disabled={!inspection}
                    onClick={() => {
                      if (inspection) {
                        void revealPath(inspection.path).catch((cause) => {
                          setRevealError(errorText(cause));
                        });
                      }
                    }}
                  >
                    <ExternalLink className="icon-sm" strokeWidth={1.75} />
                    {t("Open location")}
                  </Button>
                  <Button
                    className="shrink-0"
                    aria-label={t("Edit {p0} CLI path", { p0: title })}
                    disabled={working}
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="icon-sm" strokeWidth={1.75} />
                    {t("Edit path")}
                  </Button>
                </ModalActions>
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </span>
  );
}
