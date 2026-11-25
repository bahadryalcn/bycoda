import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import styles from "./ShortcutSettings.module.css";
import { t, useLocale } from "../../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";

import { RotateCcw, ListFilter, X } from "../../../shared/ui/icons";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { IS_MAC } from "../../../platform/tauri/platform";
import { errorText } from "../../../shared/lib/errors";
import { isDesktopGlobal } from "../model/desktopStopKeybinding";
import { applyDesktopShortcuts } from "../model/desktopTalkShortcut";

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
  subscribeKeybindings,
  subscribeQuickComposerEnabled,
  subscribeQuickComposerShortcut,
  type KeybindingOverride,
  type KeybindingRow,
} from "../model/settings";

import { persistQuickComposerShortcut } from "../model/quickComposerPersist";
import { keybindingActionLabel } from "../model/keybindingLabel";
import {
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  quickComposerShortcutPreview,
  shortcutFromKeyEvent,
} from "../../quick-composer/model/quickComposerShortcut";

import { Group, Row, RevealedSetting, Select, SettingsFeedback } from "../../../shared/ui/settings";
import { ShortcutRecorder } from "../../../shared/ui/ShortcutRecorder";
import { isImeComposition } from "../../../shared/lib/keyboard";

export type ShortcutModifier = "metaKey" | "ctrlKey" | "altKey" | "shiftKey";
type ShortcutFeedback =
  | { state: "loading" }
  | { state: "success" }
  | { state: "error"; message: string };
type ShortcutFeedbackProps = {
  onFeedbackChange?: (feedback: ShortcutFeedback | null) => void;
};

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
  onEnable,
  onReset,
}: {
  name: string;
  display: string | null;
  resetVisible: boolean;
  disabled?: boolean;
  onApply: (shortcut: string) => void | Promise<void>;
  onDisable: () => void | Promise<void>;
  onEnable?: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
} & ShortcutFeedbackProps) {
  useLocale();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  // Focus alone (Tab, programmatic focus) never starts capture; only a pointer press
  // or Enter/Space on the recorder is an intentional start.
  const intent = useRef(false);
  const focusing = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const held = useRef({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  });
  const run = async (action: () => void | Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setRecording(false);
    setBusy(true);
    setError(null);
    setSaved(false);
    onFeedbackChange?.({ state: "loading" });
    try {
      await action();
      setSaved(true);
      onFeedbackChange?.({ state: "success" });
    } catch (reason) {
      const message = t("Could not save shortcut: {p0}", { p0: errorText(reason) });
      setError(message);
      onFeedbackChange?.({ state: "error", message });
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
    onFeedbackChange?.(null);
    setRecording(true);
  };

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps window keyboard and blur listeners in sync with the enabled editor's capture ownership
  useEffect(() => {
    if (!recording) return;
    if (disabled) {
      setRecording(false);
      return;
    }
    const cancelRecording = () => {
      setRecording(false);
      setError(null);
      onFeedbackChange?.(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposition(event) || event.repeat) return;
      const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      // Tab and Shift+Tab retain forward/backward keyboard navigation.
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.code === "Tab") {
        cancelRecording();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === "Escape") {
        setRecording(false);
        setError(null);
        onFeedbackChange?.(null);
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
      if (isImeComposition(event) || event.repeat) return;
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
    window.addEventListener("blur", cancelRecording);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", cancelRecording);
    };
  }, [disabled, onApply, onDisable, onFeedbackChange, recording]);

  return (
    <div
      {...surfaceAttributes({ radius: "control" }, styles.editor)}
      aria-busy={busy}
      data-capturing={recording || undefined}
    >
      <Tooltip label={recording ? t("Del disables · Esc cancels") : undefined} asChild>
        <div className={styles.control}>
          <div
            className={styles.recorder}
            onPointerDownCapture={() => {
              intent.current = true;
            }}
            onKeyDownCapture={(event) => {
              if (event.key === "Enter" || event.key === " ") intent.current = true;
            }}
            onFocusCapture={() => {
              focusing.current = true;
            }}
            onFocus={() => {
              focusing.current = false;
              intent.current = false;
            }}
            onBlur={() => {
              focusing.current = false;
              intent.current = false;
            }}
          >
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
                if (!next) {
                  setRecording(false);
                  return;
                }
                if (focusing.current && !intent.current) return;
                beginRecording();
              }}
              displayText={
                busy
                  ? t("Saving…")
                  : recording
                    ? preview || t("Record shortcut")
                    : (display ?? t("Disabled"))
              }
            />
          </div>
          <span className={styles.actionSlot}>
            {recording ? (
              <Button
                variant="ghost"
                iconOnly
                label={t("Cancel")}
                tooltip={t("Del disables · Esc cancels")}
                onClick={() => {
                  setRecording(false);
                  setError(null);
                  onFeedbackChange?.(null);
                }}
              >
                <X aria-hidden className="icon-sm" />
              </Button>
            ) : resetVisible ? (
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
          </span>
        </div>
      </Tooltip>
      {!display && onEnable ? (
        <Button variant="ghost" disabled={busy || disabled} onClick={() => void run(onEnable)}>
          {t("Enable")}
        </Button>
      ) : null}
      {onFeedbackChange ? null : error ? (
        <SettingsFeedback state="error">{error}</SettingsFeedback>
      ) : busy || saved ? (
        <SettingsFeedback state={busy ? "loading" : "success"} immediate>
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
  const [shortcut, setShortcut] = useStoredPreferenceState(
    loadQuickComposerShortcut,
    subscribeQuickComposerShortcut,
  );
  const [enabled, setEnabled] = useStoredPreferenceState(
    loadQuickComposerEnabled,
    subscribeQuickComposerEnabled,
  );
  const persist = async (
    nextEnabled: boolean,
    nextShortcut: string,
    writeShortcut = true,
    writeEnabled = false,
  ) => {
    try {
      await persistQuickComposerShortcut(nextEnabled, nextShortcut, writeShortcut, writeEnabled);
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
      onEnable={async () => {
        const current = loadQuickComposerShortcut();
        validateKeybindingShortcut("App: Quick Composer", current);
        await persist(true, current, false, true);
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

const KeybindingSettingsRow = memo(function KeybindingSettingsRow({
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
      density="compact"
      label={
        <Text size="inherit" tone={disabled ? "disabled" : "inherit"}>
          {keybindingActionLabel(row.command)}
          {modified ? (
            <Text as="span" weight="regular" leading="inherit" className={styles.modified}>
              {t("Modified")}
            </Text>
          ) : null}
        </Text>
      }
      scope={
        row.when === "Always" ? undefined : (
          <OverflowTooltip label={t("When: {p0}", { p0: t(row.when) })}>
            <Text size="inherit" tone="muted" leading="inherit" truncate className={styles.context}>
              {t("When: {p0}", { p0: t(row.when) })}
            </Text>
          </OverflowTooltip>
        )
      }
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
          <SettingsFeedback state={feedback.state} immediate>
            {feedback.state === "error"
              ? feedback.message
              : feedback.state === "loading"
                ? t("Saving…")
                : t("Saved")}
          </SettingsFeedback>
        ) : undefined
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
});

/** Rows change with the overrides and with the Quick composer's own stored state. */
function subscribeKeybindingRows(onChange: () => void) {
  const stopBindings = subscribeKeybindings(onChange);
  const stopEnabled = subscribeQuickComposerEnabled(onChange);
  const stopShortcut = subscribeQuickComposerShortcut(onChange);
  return () => {
    stopBindings();
    stopEnabled();
    stopShortcut();
  };
}

export function KeybindingsPage() {
  const locale = useLocale();
  const revealed = useContext(RevealedSetting);
  const [query, setQuery] = useRetainedState("keybindings:query", "");
  const [category, setCategory] = useRetainedState("keybindings:category", "all");
  const [status, setStatus] = useRetainedState("keybindings:status", "all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [lastRevealed, setLastRevealed] = useState(revealed);
  if (revealed !== lastRevealed) {
    setLastRevealed(revealed);
    if (revealed?.startsWith("keybinding-")) {
      setQuery("");
      setCategory("all");
      setStatus("all");
    }
  }
  const [overrides, setOverrides] = useStoredPreferenceState(
    loadKeybindingOverrides,
    subscribeKeybindingRows,
  );
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

  const refreshOverrides = useCallback(
    () => setOverrides({ ...loadKeybindingOverrides() }),
    [setOverrides],
  );
  const save = useCallback(async (command: string, override: KeybindingOverride) => {
    if (pendingSave.current) throw new Error(t("Saving…"));
    pendingSave.current = true;
    setSaving(true);
    try {
      const previous = loadKeybindingOverrides();
      const next = prepareKeybindingOverride(command, override);
      let nativeAttempted = false;
      let desktopAttempted = false;
      try {
        if (isDesktopGlobal(command)) {
          desktopAttempted = true;
          await applyDesktopShortcuts(next);
        }
        if (IS_MAC) {
          nativeAttempted = true;
          await invoke("keybindings_set_overrides", { overrides: next });
        }
        saveKeybindingOverride(command, override);
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        if (desktopAttempted) {
          try {
            await applyDesktopShortcuts(previous);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (nativeAttempted) {
          try {
            await invoke("keybindings_set_overrides", { overrides: previous });
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length)
          throw new Error(
            t("Shortcut save failed: {p0}. Restoring the native shortcut also failed: {p1}", {
              p0: errorText(error),
              p1: rollbackErrors.map(errorText).join("; "),
            }),
          );
        throw error;
      }
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.band}>
        <div className={styles.search}>
          <SearchInput
            type="search"
            appearance="quiet"
            aria-label={t("Filter keybindings")}
            placeholder={t("Filter keybindings")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
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
        {query.trim() || filtered ? (
          <Text
            size="caption"
            tone="secondary"
            leading="inherit"
            className={`${styles.summary} tabular-nums`}
            role="status"
          >
            {t("Showing {p0} of {p1} bindings", { p0: rows.length, p1: allRows.length })}
          </Text>
        ) : null}
        {filtersOpen ? (
          <Popover
            anchor={filterAnchor}
            kind="dialog"
            aria-label={t("Filters")}
            width={280}
            variant="panel"
            flow="scroll"
            onDismiss={() => setFiltersOpen(false)}
          >
            <Text as="div" size="caption" tone="secondary" leading="inherit">
              <div className={styles.filterStack}>
                <Text as="span" size="secondary" weight="medium" tone="primary">
                  {t("Category")}
                </Text>
                <Select
                  hideLabel
                  label={t("Category")}
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "all", label: t("All categories") },
                    ...categories.map((value) => ({ value, label: t(value) })),
                  ]}
                />
                <Text as="span" size="secondary" weight="medium" tone="primary">
                  {t("Status")}
                </Text>
                <Select
                  hideLabel
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
            </Text>
          </Popover>
        ) : null}
      </div>
      {filtered ? (
        <Text as="div" size="caption" tone="secondary" leading="inherit">
          <div className={styles.activeFilters}>
            <span>
              {[
                category !== "all" ? `${t("Category")}: ${t(category)}` : null,
                status !== "all"
                  ? `${t("Status")}: ${t(status === "modified" ? "Modified" : status === "disabled" ? "Disabled" : "Unassigned")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              {t("Reset filters")}
            </Button>
          </div>
        </Text>
      ) : null}
      <div className={styles.list}>
        {rows.length === 0 ? (
          <SettingsFeedback
            state="empty"
            action={{
              label: t("Clear search and filters"),
              onClick: () => {
                setQuery("");
                resetFilters();
              },
            }}
          >
            {t("No matching bindings")}
          </SettingsFeedback>
        ) : (
          categories.map((group) => {
            const entries = rows.filter((row) => row.command.startsWith(`${group}:`));
            if (!entries.length) return null;
            return (
              <Group
                key={group}
                title={
                  <span>
                    {t(group)}{" "}
                    <Text size="caption" tone="muted" leading="inherit" className="tabular-nums">
                      · {entries.length}
                    </Text>
                  </span>
                }
              >
                {entries.map((row) => (
                  <KeybindingSettingsRow
                    key={row.command}
                    row={row}
                    override={overrides[row.command]}
                    modified={isModified(row.command)}
                    saving={saving}
                    onSave={save}
                    onSaved={refreshOverrides}
                  />
                ))}
              </Group>
            );
          })
        )}
      </div>
    </div>
  );
}
