import { Badge } from "../../../shared/ui/Badge";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { ExternalLink, FolderOpen, Pencil, RefreshCw } from "../../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Popover } from "../../../shared/ui/Popover";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";

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

import { revealPath } from "../../../platform/tauri/fs";

import { HARNESS_TITLE } from "../../sessions/model/session";

export const GLOBAL_PROVIDER_SCOPE = "global";

export function binaryInspectionError(
  provider: ConfigurableBinaryProvider,
  inspection: HarnessBinaryInspection,
): string | null {
  if (inspection.error) return inspection.error;
  if (provider === "codex" && !/^codex-cli\s+\d+\.\d+\.\d+/.test(inspection.version ?? "")) {
    return "Codex CLI returned an invalid version.";
  }
  if (provider === "opencode") {
    const version = parseOpenCodeVersion(inspection.version ?? "");
    if (!version) return "OpenCode CLI returned an invalid version.";
    if (compareSemver(version, MINIMUM_OPENCODE_VERSION) < 0) {
      return `OpenCode v${version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`;
    }
  }
  return null;
}

export function ProviderBinaryControl({
  provider,
  showLabel = false,
}: {
  provider: ConfigurableBinaryProvider;
  showLabel?: boolean;
}) {
  useLocale();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => loadProviderBinaryPath(provider) ?? "");
  const [overridden, setOverridden] = useState(() => Boolean(loadProviderBinaryPath(provider)));
  const [inspection, setInspection] = useState<HarnessBinaryInspection & { overridden: boolean }>();
  const [working, setWorking] = useState(false);
  const inspectionBusy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const inspect = useCallback(
    async (binaryPath?: string | null) => {
      if (inspectionBusy.current) return null;
      inspectionBusy.current = true;
      setWorking(true);
      setInspection(undefined);
      setError(null);
      setRevealError(null);
      try {
        const next = await inspectHarnessBinary(provider, binaryPath);
        setInspection({
          ...next,
          overridden: Boolean(binaryPath?.trim()),
        });
        setError(binaryInspectionError(provider, next));
        return next;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        return null;
      } finally {
        inspectionBusy.current = false;
        setWorking(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    if (editing) editInput.current?.focus();
  }, [editing]);

  const dismiss = (restoreFocus = false) => {
    setOpen(false);
    setEditing(false);
    if (restoreFocus) queueMicrotask(() => trigger.current?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working) return;
    const value = draft.trim();
    if (!value) {
      await useAuto();
      return;
    }
    const next = await inspect(value);
    if (!next) return;
    const validationError = binaryInspectionError(provider, next);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!saveProviderBinaryPath(provider, value)) {
      setInspection(undefined);
      setError(t("Could not save the binary path."));
      return;
    }
    setOverridden(true);
    dismiss(true);
  };

  const useAuto = async () => {
    if (working) return;
    const next = await inspect(null);
    if (!next || binaryInspectionError(provider, next)) return;
    if (!saveProviderBinaryPath(provider, null)) {
      setInspection(undefined);
      setError(t("Could not save the binary path."));
      return;
    }
    setDraft("");
    setOverridden(false);
    dismiss(true);
  };

  const title = HARNESS_TITLE[provider];
  const restartRequired = providerBinaryPathChangePending(provider);

  return (
    <span ref={root} className="inline-flex align-middle">
      <Button
        variant="ghost"
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
        title={t(restartRequired ? "{p0} CLI path — restart required" : "{p0} CLI path", {
          p0: title,
        })}
        onClick={() => {
          if (!open && !inspection && !working && !error) {
            void inspect(loadProviderBinaryPath(provider));
          }
          setOpen((value) => !value);
          setEditing(false);
        }}
      >
        <FolderOpen className="size-3.5" strokeWidth={1.75} />
        {showLabel ? t("CLI setup") : null}
      </Button>
      {open ? (
        <Popover
          id={`${provider}-binary-popover`}
          role="dialog"
          aria-label={t("{p0} CLI details", { p0: title })}
          aria-busy={working}
          tabIndex={-1}
          anchor={root}
          side="bottom"
          align="start"
          width={440}
          className="p-3"
          autoFocus
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
              ),
            );
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
          onDismiss={(reason) => dismiss(reason === "escape")}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-content">
              {title}
              {t(" CLI")}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] text-content/50">
                {t("This machine · all projects")}
              </span>
              <span className="rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] text-content/50">
                {working
                  ? t("Checking…")
                  : error
                    ? t("Needs attention")
                    : restartRequired
                      ? t("Restart required")
                      : overridden
                        ? t("Configured")
                        : inspection
                          ? t("Auto-detected")
                          : t("Not checked yet")}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-content/60">
            {t(
              "The CLI path selects an executable on this machine. Account sign-in and model defaults are managed separately.",
            )}
          </p>
          {editing ? (
            <form className="mt-2" onSubmit={submit}>
              <label htmlFor={`${provider}-binary-path`} className="text-[11px] text-content/50">
                {t("CLI path")}
              </label>
              <TextField
                hideLabel
                label={t("CLI path")}
                id={`${provider}-binary-path`}
                ref={editInput}
                type="text"
                value={draft}
                placeholder={inspection?.path ?? t("Auto-detected path")}
                disabled={working}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              <p className="mt-1.5 text-[10px] text-content/40">
                {t(
                  "Enter the absolute path to the CLI executable. Changes apply after restarting ",
                )}
                {PRODUCT_IDENTITY.displayName}.
              </p>
              {error ? (
                <Badge tone="danger" role="alert">
                  {error}
                </Badge>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <SecondaryButton
                  disabled={working}
                  onClick={() => {
                    setDraft(loadProviderBinaryPath(provider) ?? "");
                    setEditing(false);
                    queueMicrotask(() => trigger.current?.focus());
                  }}
                >
                  {t("Cancel")}
                </SecondaryButton>
                {overridden ? (
                  <SecondaryButton disabled={working} onClick={() => void useAuto()}>
                    {t("Use auto-detected path")}
                  </SecondaryButton>
                ) : null}
                <SecondaryButton type="submit" disabled={working}>
                  {working ? t("Checking path…") : t("Save path")}
                </SecondaryButton>
              </div>
            </form>
          ) : (
            <>
              <div className="mt-2 rounded-md border border-content/10 bg-content/[0.03] px-2.5 py-2">
                <span className="block max-h-12 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] text-content/65">
                  {inspection?.path ??
                    (error ? t("CLI could not be resolved") : t("Checking the selected CLI…"))}
                </span>
                <span className="mt-1 block max-h-10 overflow-y-auto whitespace-pre-wrap break-words text-[10px] text-content/40">
                  {inspection?.version ??
                    (error ? t("Retry to check this CLI") : t("Checking version…"))}
                </span>
              </div>
              {error ? (
                <Badge tone="danger" role="alert" title={error}>
                  {error}
                </Badge>
              ) : null}
              {revealError ? (
                <Badge tone="danger" role="alert">
                  {t("Could not open the CLI location: ")}
                  {revealError}
                </Badge>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                {error ? (
                  <SecondaryButton
                    disabled={working}
                    aria-label={t(
                      overridden ? "Retry {p0} configured path" : "Retry {p0} auto-detect",
                      { p0: title },
                    )}
                    onClick={() => void inspect(overridden ? draft.trim() || null : null)}
                  >
                    <RefreshCw className="size-3.5" strokeWidth={1.75} />
                    {overridden ? t("Retry configured path") : t("Retry auto-detect")}
                  </SecondaryButton>
                ) : null}
                <SecondaryButton
                  aria-label={t("Open {p0} CLI location", { p0: title })}
                  disabled={!inspection}
                  onClick={() => {
                    if (inspection) {
                      void revealPath(inspection.path).catch((cause) => {
                        setRevealError(cause instanceof Error ? cause.message : String(cause));
                      });
                    }
                  }}
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.75} />
                  {t("Open location")}
                </SecondaryButton>
                <SecondaryButton
                  aria-label={t("Edit {p0} CLI path", { p0: title })}
                  disabled={working}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" strokeWidth={1.75} />
                  {t("Edit path")}
                </SecondaryButton>
              </div>
            </>
          )}
        </Popover>
      ) : null}
    </span>
  );
}
