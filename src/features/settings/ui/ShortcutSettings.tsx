import { TextField } from "../../../shared/ui/TextField";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import styles from "./ShortcutSettings.module.css";
import { t, useLocale } from "../../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";

import { RotateCcw, CircleHelp, ListFilter } from "../../../shared/ui/icons";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { IS_MAC } from "../../../platform/tauri/platform";

import {
  filterKeybindings,
  KEYBINDINGS,
  currentKeybindings,
  keybindingSettingId,
  loadKeybindingOverrides,
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
  saveKeybindingOverride,
  prepareKeybindingOverride,
  validateKeybindingShortcut,
  saveQuickComposerEnabled,
  saveQuickComposerShortcut,
  subscribeKeybindings,
  subscribeQuickComposerEnabled,
  subscribeQuickComposerShortcut,
  type KeybindingOverride,
  type KeybindingRow,
} from "../model/settings";

import { setQuickComposerShortcut } from "../../quick-composer/model/quickComposer";
import {
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  quickComposerShortcutPreview,
  shortcutFromKeyEvent,
} from "../../quick-composer/model/quickComposerShortcut";

import { Group, Row, RevealedSetting, Select, SettingsFeedback } from "./settingsControls";
import { ShortcutRecorder } from "../../../shared/ui/ShortcutRecorder";

export type ShortcutModifier = "metaKey" | "ctrlKey" | "altKey" | "shiftKey";
type ShortcutFeedback = { state: "loading" | "success" | "error"; message: string };
type ShortcutFeedbackProps = { onFeedbackChange?: (feedback: ShortcutFeedback | null) => void };

export function shortcutModifier(event: KeyboardEvent): ShortcutModifier | null {
  if (event.key === "Meta" || event.code.startsWith("Meta")) return "metaKey";
  if (event.key === "Control" || event.code.startsWith("Control")) return "ctrlKey";
  if (event.key === "Alt" || event.code.startsWith("Alt")) return "altKey";
  if (event.key === "Shift" || event.code.startsWith("Shift")) return "shiftKey";
  return null;
}

export function ShortcutEditor({
  name,
  display,
  resetVisible,
  disabled = false,
  onFeedbackChange,
  onApply,
  onDisable,
  onReset,
}: {
  name: string;
  display: string | null;
  resetVisible: boolean;
  disabled?: boolean;
  onApply: (shortcut: string) => void | Promise<void>;
  onDisable: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
} & ShortcutFeedbackProps) {
  const locale = useLocale();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const held = useRef({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  });
  useEffect(() => {
    onFeedbackChange?.(
      error
        ? { state: "error", message: error }
        : busy || saved
          ? {
              state: busy ? "loading" : "success",
              message: busy ? t("Saving…") : t("Saved"),
            }
          : null,
    );
  }, [onFeedbackChange, error, busy, saved, locale]);

  const run = async (action: () => void | Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setRecording(false);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      setSaved(true);
    } catch (reason) {
      setError(t("Could not save shortcut: {p0}", { p0: String(reason) }));
    } finally {
      setBusy(false);
      pending.current = false;
    }
  };

  const beginRecording = () => {
    if (disabled || pending.current) return;
    held.current = {
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    setPreview("");
    setError(null);
    setSaved(false);
    setRecording(true);
  };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      // An unmodified Tab leaves the recorder instead of trapping focus.
      if (bare && event.code === "Tab") {
        setRecording(false);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        setRecording(false);
        setError(null);
        return;
      }
      // Delete disables, but only on its own so Cmd+Delete still records.
      if (bare && (event.code === "Backspace" || event.code === "Delete")) {
        void run(onDisable);
        return;
      }
      const modifier = shortcutModifier(event);
      if (modifier) held.current[modifier] = true;
      const modifiers = {
        metaKey: event.metaKey || held.current.metaKey,
        ctrlKey: event.ctrlKey || held.current.ctrlKey,
        altKey: event.altKey || held.current.altKey,
        shiftKey: event.shiftKey || held.current.shiftKey,
      };
      setPreview(
        quickComposerShortcutPreview(modifiers, modifier ? undefined : event.code, event.key),
      );
      if (modifier) return;
      const next = shortcutFromKeyEvent({ ...modifiers, code: event.code });
      if (next) void run(() => onApply(next));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const modifier = shortcutModifier(event);
      if (!modifier) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      held.current[modifier] = false;
      const modifiers = {
        metaKey: event.metaKey || held.current.metaKey,
        ctrlKey: event.ctrlKey || held.current.ctrlKey,
        altKey: event.altKey || held.current.altKey,
        shiftKey: event.shiftKey || held.current.shiftKey,
      };
      modifiers[modifier] = false;
      setPreview(quickComposerShortcutPreview(modifiers));
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [onApply, onDisable, recording]);

  return (
    <div className={styles.editor} aria-busy={busy}>
      <div className="flex items-center gap-0.5">
        <ShortcutRecorder
          label={t("Change {p0} shortcut", { p0: name })}
          hideLabel
          hideActions
          platform={IS_MAC ? "mac" : "other"}
          disabled={busy || disabled}
          recording={recording}
          displayKeys={
            !recording && !busy && display && display !== t("Unassigned")
              ? (display.match(/[⌘⌃⌥⇧]|(?:Ctrl|Control|Alt|Shift|Win)\+|.+/g) ?? [display]).map(
                  (key) => (key.length > 1 ? key.replace(/\+$/, "") : key),
                )
              : undefined
          }
          onRecordingChange={(next) => {
            if (next) beginRecording();
            else setRecording(false);
          }}
          displayText={
            busy
              ? t("Saving…")
              : recording
                ? preview || t("Record shortcut")
                : (display ?? t("Disabled"))
          }
        />
        {resetVisible ? (
          <Button
            variant="ghost"
            iconOnly
            label={t("Reset {p0} shortcut", { p0: name })}
            disabled={busy || disabled}
            onClick={() => void run(onReset)}
          >
            <RotateCcw aria-hidden strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
      {recording ? (
        <p className={styles.hint} aria-live="polite">
          {t("Del disables · Esc cancels")}
        </p>
      ) : null}
      {onFeedbackChange ? null : error ? (
        <SettingsFeedback state="error">{error}</SettingsFeedback>
      ) : busy || saved ? (
        <SettingsFeedback state={busy ? "loading" : "success"}>
          {busy ? t("Saving…") : t("Saved")}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}

export function QuickComposerShortcutEditor({
  onSaved,
  onFeedbackChange,
}: { onSaved?: () => void } & ShortcutFeedbackProps = {}) {
  useLocale();
  const [shortcut, setShortcut] = useState(loadQuickComposerShortcut);
  const [enabled, setEnabled] = useState(loadQuickComposerEnabled);
  useEffect(() => {
    const refresh = () => {
      setEnabled(loadQuickComposerEnabled());
      setShortcut(loadQuickComposerShortcut());
    };
    const stopEnabled = subscribeQuickComposerEnabled(refresh);
    const stopShortcut = subscribeQuickComposerShortcut(refresh);
    return () => { stopEnabled(); stopShortcut(); };
  }, []);
  const persist = async (nextEnabled: boolean, nextShortcut: string, writeShortcut = true, writeEnabled = false) => {
    const previousEnabled = loadQuickComposerEnabled();
    const previousShortcut = loadQuickComposerShortcut();
    let nativeAttempted = false;
    let shortcutWritten = false;
    let enabledWritten = false;
    try {
      if (nextEnabled || previousEnabled) {
        nativeAttempted = true;
        await setQuickComposerShortcut(nextEnabled, nextShortcut);
      }
      if (writeShortcut) {
        shortcutWritten = true;
        if (saveQuickComposerShortcut(nextShortcut) === false) throw new Error(t("Could not save changes"));
      }
      if (writeEnabled) {
        enabledWritten = true;
        if (saveQuickComposerEnabled(nextEnabled) === false) throw new Error(t("Could not save changes"));
      }
    } catch (reason) {
      const failures = [String(reason)];
      const rollback = async (action: () => boolean | void | Promise<void>) => {
        try {
          if (await action() === false) throw new Error(t("Could not save changes"));
        } catch (error) {
          failures.push(t("Restoring the previous shortcut failed: {p0}", { p0: String(error) }));
        }
      };
      if (shortcutWritten) await rollback(() => saveQuickComposerShortcut(previousShortcut));
      if (enabledWritten) await rollback(() => saveQuickComposerEnabled(previousEnabled));
      if (nativeAttempted) await rollback(() => setQuickComposerShortcut(previousEnabled, previousShortcut));
      throw new Error(failures.join(" "));
    } finally {
      setShortcut(loadQuickComposerShortcut());
      setEnabled(loadQuickComposerEnabled());
    }
    onSaved?.();
  };
  const apply = async (next: string) => {
    if (!isGlobalShortcut(next))
      throw new Error(t("Quick Composer needs ⌘ or Ctrl as a global hotkey"));
    // Validate before the native call: a rejected chord must not leave the OS
    // holding a registered global hotkey that settings does not know about.
    validateKeybindingShortcut("App: Quick Composer", next);
    // Recording while the feature is off must not silently switch it back on.
    await persist(loadQuickComposerEnabled(), next);
  };
  const reset = async () => {
    // Reset restores the whole default state, including the enabled flag.
    validateKeybindingShortcut("App: Quick Composer", QUICK_COMPOSER_DEFAULT_SHORTCUT);
    await persist(true, QUICK_COMPOSER_DEFAULT_SHORTCUT, true, true);
  };
  return (
    <ShortcutEditor
      name={t("Quick composer")}
      onFeedbackChange={onFeedbackChange}
      display={enabled ? quickComposerShortcutLabel(shortcut) : null}
      resetVisible={enabled !== true || shortcut !== QUICK_COMPOSER_DEFAULT_SHORTCUT}
      onApply={apply}
      onDisable={async () => {
        await persist(false, loadQuickComposerShortcut(), false, true);
      }}
      onReset={reset}
    />
  );
}

export function KeybindingShortcutEditor({
  command,
  display,
  modified,
  onSave,
  disabled,
  onFeedbackChange,
}: {
  command: string;
  display: string | null;
  modified: boolean;
  disabled?: boolean;
  onSave: (command: string, override: KeybindingOverride) => void | Promise<void>;
} & ShortcutFeedbackProps) {
  useLocale();
  return (
    <ShortcutEditor
      name={command}
      display={display}
      resetVisible={modified}
      disabled={disabled}
      onFeedbackChange={onFeedbackChange}
      onApply={(shortcut) => onSave(command, { shortcut })}
      onDisable={() => onSave(command, { disabled: true })}
      onReset={() => onSave(command, {})}
    />
  );
}

function KeybindingSettingsRow({
  row,
  override,
  modified,
  saving,
  onSave,
  onSaved,
}: {
  row: KeybindingRow;
  override?: KeybindingOverride;
  modified: boolean;
  saving: boolean;
  onSave: (command: string, override: KeybindingOverride) => Promise<void>;
  onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState<ShortcutFeedback | null>(null);
  const disabled = row.keys === "Disabled";
  return (
    <Row
      id={keybindingSettingId(row.command)}
      label={
        <span title={t(row.command)} className={disabled ? styles.disabled : undefined}>
          {t(row.command).replace(/^[^:]+:\s*/, "")}
          {modified ? <span className={styles.modified}>{t("Modified")}</span> : null}
        </span>
      }
      scope={row.when === "Always" ? undefined : t("When: {p0}", { p0: t(row.when) })}
      description={
        modified
          ? t("Default: {p0}", {
              p0:
                KEYBINDINGS.find((entry) => entry.command === row.command)?.keys || t("Unassigned"),
            })
          : undefined
      }
      feedback={
        feedback ? (
          <SettingsFeedback state={feedback.state}>{feedback.message}</SettingsFeedback>
        ) : null
      }
    >
      {row.command === "App: Quick Composer" ? (
        <QuickComposerShortcutEditor onSaved={onSaved} onFeedbackChange={setFeedback} />
      ) : (
        <KeybindingShortcutEditor
          command={row.command}
          display={disabled ? null : row.keys || t("Unassigned")}
          modified={Boolean(override)}
          disabled={saving}
          onSave={onSave}
          onFeedbackChange={setFeedback}
        />
      )}
    </Row>
  );
}

export function KeybindingsPage() {
  const locale = useLocale();
  const revealed = useContext(RevealedSetting);
  const [query, setQuery] = useRetainedState("keybindings:query", "");
  const [category, setCategory] = useRetainedState("keybindings:category", "all");
  const [status, setStatus] = useRetainedState("keybindings:status", "all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const helpAnchor = useRef<HTMLButtonElement>(null);
  const [lastRevealed, setLastRevealed] = useState(revealed);
  if (revealed !== lastRevealed) {
    setLastRevealed(revealed);
    if (revealed?.startsWith("keybinding-")) {
      setQuery("");
      setCategory("all");
      setStatus("all");
    }
  }
  const [overrides, setOverrides] = useState(loadKeybindingOverrides);
  useEffect(() => {
    const refresh = () => setOverrides({ ...loadKeybindingOverrides() });
    const stopBindings = subscribeKeybindings(refresh);
    const stopEnabled = subscribeQuickComposerEnabled(refresh);
    const stopShortcut = subscribeQuickComposerShortcut(refresh);
    return () => { stopBindings(); stopEnabled(); stopShortcut(); };
  }, []);
  const allRows = useMemo(() => currentKeybindings(), [overrides, locale]);
  const categories = [...new Set(KEYBINDINGS.map((row) => row.command.split(":")[0]))];
  const isModified = (command: string) =>
    command === "App: Quick Composer"
      ? !loadQuickComposerEnabled() ||
        loadQuickComposerShortcut() !== QUICK_COMPOSER_DEFAULT_SHORTCUT
      : Boolean(overrides[command]);
  const rows = filterKeybindings(allRows, query).filter(
    (row) =>
      (category === "all" || row.command.startsWith(`${category}:`)) &&
      (status === "all" ||
        (status === "modified"
          ? isModified(row.command)
          : status === "unassigned"
            ? !row.keys
            : row.keys === "Disabled")),
  );
  const filtered = category !== "all" || status !== "all";
  const resetFilters = () => {
    setCategory("all");
    setStatus("all");
  };

  const save = async (command: string, override: KeybindingOverride) => {
    if (pendingSave.current) throw new Error(t("Saving…"));
    pendingSave.current = true;
    setSaving(true);
    try {
      const previous = loadKeybindingOverrides();
      const next = prepareKeybindingOverride(command, override);
      let nativeAttempted = false;
      try {
        if (IS_MAC) {
          nativeAttempted = true;
          await invoke("keybindings_set_overrides", { overrides: next });
        }
        saveKeybindingOverride(command, override);
      } catch (error) {
        if (nativeAttempted) {
          try {
            await invoke("keybindings_set_overrides", { overrides: previous });
          } catch (rollbackError) {
            throw new Error(t("Shortcut save failed: {p0}. Restoring the native shortcut also failed: {p1}", {
              p0: String(error), p1: String(rollbackError),
            }));
          }
        }
        throw error;
      }
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <Group
        title={t("Shortcuts")}
        layout="full"
        description={t("Click a shortcut to record new keys. Changes save automatically.")}
      >
        <div className={styles.toolbar}>
          <TextField
            type="search"
            label={t("Filter keybindings")}
            hideLabel
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Filter keybindings")}
            spellCheck={false}
            autoComplete="off"
          />
          <span className={styles.summary} role="status">
            {t("Showing {p0} of {p1} bindings", { p0: rows.length, p1: allRows.length })}
          </span>
          <Button
            ref={filterAnchor}
            variant="ghost"
            iconOnly
            label={t("Filters")}
            selected={filtered}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <ListFilter aria-hidden strokeWidth={1.75} />
          </Button>
          <Button
            ref={helpAnchor}
            variant="ghost"
            iconOnly
            label={t("Shortcut help")}
            aria-expanded={helpOpen}
            aria-haspopup="dialog"
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <CircleHelp aria-hidden strokeWidth={1.75} />
          </Button>
          {filtersOpen ? (
            <Popover
              anchor={filterAnchor}
              role="dialog"
              aria-label={t("Filters")}
              width={280}
              autoFocus
              onDismiss={() => setFiltersOpen(false)}
            >
              <div className={styles.popover}>
                <span className="text-ui-secondary font-medium text-content">{t("Category")}</span>
                <Select
                  label={t("Category")}
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "all", label: t("All categories") },
                    ...categories.map((value) => ({ value, label: t(value) })),
                  ]}
                />
                <span className="text-ui-secondary font-medium text-content">{t("Status")}</span>
                <Select
                  label={t("Status")}
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: t("All bindings") },
                    { value: "modified", label: t("Modified") },
                    { value: "disabled", label: t("Disabled") },
                    { value: "unassigned", label: t("Unassigned") },
                  ]}
                />
                <Button variant="ghost" onClick={resetFilters} disabled={!filtered}>
                  {t("Reset filters")}
                </Button>
              </div>
            </Popover>
          ) : null}
          {helpOpen ? (
            <Popover
              anchor={helpAnchor}
              role="dialog"
              aria-label={t("Shortcut help")}
              width={320}
              autoFocus
              onDismiss={() => setHelpOpen(false)}
            >
              <div className={styles.popover}>
                <p>
                  {t(
                    "App shortcuts apply while this app is focused. Quick composer uses a global shortcut on this computer.",
                  )}
                </p>
                <p>
                  {t(
                    "Conflicting shortcuts are rejected. Press Escape to cancel, Delete to disable, or use Reset to restore the default.",
                  )}
                </p>
              </div>
            </Popover>
          ) : null}
        </div>
        {filtered ? (
          <p className={styles.activeSummary}>
            {[
              category !== "all" ? `${t("Category")}: ${t(category)}` : null,
              status !== "all" ? `${t("Status")}: ${t(status === "modified" ? "Modified" : status === "disabled" ? "Disabled" : "Unassigned")}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <div className={styles.list}>
          {rows.length === 0 ? (
            <SettingsFeedback
              state="empty"
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setQuery("");
                    resetFilters();
                  }}
                >
                  {t("Clear search and filters")}
                </Button>
              }
            >
              {t("No matching bindings")}
            </SettingsFeedback>
          ) : (
            categories.map((group) => {
              const entries = rows.filter((row) => row.command.startsWith(`${group}:`));
              if (!entries.length) return null;
              return (
                <section key={group} aria-label={t(group)}>
                  <h3 className={styles.category}>
                    {t(group)} <span>{entries.length}</span>
                  </h3>
                  {entries.map((row) => (
                    <KeybindingSettingsRow
                      key={row.command}
                      row={row}
                      override={overrides[row.command]}
                      modified={isModified(row.command)}
                      saving={saving}
                      onSave={save}
                      onSaved={() => setOverrides({ ...loadKeybindingOverrides() })}
                    />
                  ))}
                </section>
              );
            })
          )}
        </div>
      </Group>
    </div>
  );
}
