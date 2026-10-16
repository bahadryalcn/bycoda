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
  validateKeybindingShortcut,
  saveQuickComposerEnabled,
  saveQuickComposerShortcut,
  subscribeKeybindings,
  type KeybindingOverride,
} from "../model/settings";

import { setQuickComposerShortcut } from "../../quick-composer/model/quickComposer";
import {
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  quickComposerShortcutPreview,
  shortcutFromKeyEvent,
} from "../../quick-composer/model/quickComposerShortcut";

import { Group, Row, RevealedSetting, Select } from "./settingsControls";
import { ShortcutRecorder } from "../../../shared/ui/ShortcutRecorder";

export type ShortcutModifier = "metaKey" | "ctrlKey" | "altKey" | "shiftKey";

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
  onApply,
  onDisable,
  onReset,
}: {
  name: string;
  display: string | null;
  resetVisible: boolean;
  onApply: (shortcut: string) => void | Promise<void>;
  onDisable: () => void | Promise<void>;
  onReset: () => void | Promise<void>;
}) {
  useLocale();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const held = useRef({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  });

  const run = async (action: () => void | Promise<void>) => {
    setRecording(false);
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const beginRecording = () => {
    held.current = {
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    setPreview("");
    setError(null);
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
          disabled={busy}
          recording={recording}
          onRecordingChange={(next) => {
            if (next) beginRecording();
            else setRecording(false);
          }}
          displayText={
            recording || busy ? preview || t("Record shortcut") : (display ?? t("Disabled"))
          }
        />
        {resetVisible ? (
          <Button
            variant="ghost"
            iconOnly
            label={t("Reset {p0} shortcut", { p0: name })}
            disabled={busy}
            onClick={() => void run(onReset)}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {recording ? (
        <p className={styles.hint} aria-live="polite">
          {t("Del disables · Esc cancels")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function QuickComposerShortcutEditor({ onSaved }: { onSaved?: () => void } = {}) {
  useLocale();
  const [shortcut, setShortcut] = useState(loadQuickComposerShortcut);
  const [enabled, setEnabled] = useState(loadQuickComposerEnabled);
  const apply = async (next: string) => {
    if (!isGlobalShortcut(next))
      throw new Error(t("Quick Composer needs ⌘ or Ctrl as a global hotkey"));
    // Validate before the native call: a rejected chord must not leave the OS
    // holding a registered global hotkey that settings does not know about.
    validateKeybindingShortcut("App: Quick Composer", next);
    // Recording while the feature is off must not silently switch it back on.
    if (enabled) await setQuickComposerShortcut(true, next);
    saveQuickComposerShortcut(next);
    setShortcut(next);
    onSaved?.();
  };
  const reset = async () => {
    // Reset restores the whole default state, including the enabled flag.
    validateKeybindingShortcut("App: Quick Composer", QUICK_COMPOSER_DEFAULT_SHORTCUT);
    await setQuickComposerShortcut(true, QUICK_COMPOSER_DEFAULT_SHORTCUT);
    saveQuickComposerEnabled(true);
    saveQuickComposerShortcut(QUICK_COMPOSER_DEFAULT_SHORTCUT);
    setShortcut(QUICK_COMPOSER_DEFAULT_SHORTCUT);
    setEnabled(true);
    onSaved?.();
  };
  return (
    <ShortcutEditor
      name={t("Quick composer")}
      display={enabled ? quickComposerShortcutLabel(shortcut) : null}
      resetVisible={enabled !== true || shortcut !== QUICK_COMPOSER_DEFAULT_SHORTCUT}
      onApply={apply}
      onDisable={async () => {
        await setQuickComposerShortcut(false);
        saveQuickComposerEnabled(false);
        setEnabled(false);
        onSaved?.();
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
}: {
  command: string;
  display: string | null;
  modified: boolean;
  onSave: (command: string, override: KeybindingOverride) => void | Promise<void>;
}) {
  useLocale();
  return (
    <ShortcutEditor
      name={command}
      display={display}
      resetVisible={modified}
      onApply={(shortcut) => onSave(command, { shortcut })}
      onDisable={() => onSave(command, { disabled: true })}
      onReset={() => onSave(command, {})}
    />
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
  useEffect(() => subscribeKeybindings(() => setOverrides(loadKeybindingOverrides())), []);
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
    const next = saveKeybindingOverride(command, override);
    if (IS_MAC) await invoke("keybindings_set_overrides", { overrides: next });
  };

  return (
    <Group
      title={t("Shortcuts")}
      layout="full"
      description={t("Click a shortcut to record new keys. Changes save automatically.")}
      action={
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
            {rows.length} / {allRows.length} {t("bindings")}
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
            <ListFilter className="size-4" />
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
            <CircleHelp className="size-4" />
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
                <Select
                  label={t("Category")}
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "all", label: t("All categories") },
                    ...categories.map((value) => ({ value, label: t(value) })),
                  ]}
                />
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
      }
    >
      <div className={styles.list}>
        {rows.length === 0 ? (
          <div className={styles.empty}>
            <p>{t("No matching bindings")}</p>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                resetFilters();
              }}
            >
              {t("Reset filters")}
            </Button>
          </div>
        ) : (
          categories.map((group) => {
            const entries = rows.filter((row) => row.command.startsWith(`${group}:`));
            if (!entries.length) return null;
            return (
              <section key={group} aria-label={t(group)}>
                <h3 className={styles.category}>
                  {t(group)} <span>{entries.length}</span>
                </h3>
                {entries.map((row) => {
                  const override = overrides[row.command];
                  const disabled = override?.disabled === true;
                  return (
                    <Row
                      key={row.command}
                      id={keybindingSettingId(row.command)}
                      label={
                        <span
                          title={t(row.command)}
                          className={disabled ? styles.disabled : undefined}
                        >
                          {t(row.command).replace(/^[^:]+:\s*/, "")}
                          {isModified(row.command) ? (
                            <span className={styles.modified}>{t("Modified")}</span>
                          ) : null}
                        </span>
                      }
                      scope={
                        row.when === "Always" ? undefined : t("When: {p0}", { p0: t(row.when) })
                      }
                      description={
                        isModified(row.command)
                          ? t("Default: {p0}", {
                              p0:
                                KEYBINDINGS.find((entry) => entry.command === row.command)?.keys ||
                                t("Unassigned"),
                            })
                          : undefined
                      }
                    >
                      {row.command === "App: Quick Composer" ? (
                        <QuickComposerShortcutEditor
                          onSaved={() => setOverrides({ ...loadKeybindingOverrides() })}
                        />
                      ) : (
                        <KeybindingShortcutEditor
                          command={row.command}
                          display={disabled ? null : row.keys || t("Unassigned")}
                          modified={Boolean(override)}
                          onSave={save}
                        />
                      )}
                    </Row>
                  );
                })}
              </section>
            );
          })
        )}
      </div>
    </Group>
  );
}
