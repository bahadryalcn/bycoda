import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { Check, ChevronDown, Lock, Pencil, Shield, Sparkles } from "../../../shared/ui/icons";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../model/session";
import { Popover } from "../../../shared/ui/Popover";

type Props = {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  onClose?: () => void;
  busy?: boolean;
  /** Modes the harness cannot honour, with why. They show, but cannot be picked. */
  unavailable?: Partial<Record<RuntimeMode, string>>;
};

const MENU_WIDTH = 288;

const ICONS: Record<RuntimeMode, typeof Lock> = {
  supervised: Lock,
  "auto-accept-edits": Pencil,
  auto: Sparkles,
  "full-access": Shield,
};

export function AccessPicker({ value, onChange, onClose, busy = false, unavailable }: Props) {
  useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  const [active, setActive] = useState(() => Math.max(0, RUNTIME_MODES.indexOf(value)));
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const Icon = ICONS[value];

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, RUNTIME_MODES.indexOf(value)));
  }, [open, value]);

  const pick = (mode: RuntimeMode) => {
    if (unavailable?.[mode]) return;
    onChange(mode);
    dismiss(true);
  };

  // Arrow keys skip what cannot be picked.
  const step = (from: number, direction: 1 | -1) => {
    for (let i = from + direction; i >= 0 && i < RUNTIME_MODES.length; i += direction) {
      if (!unavailable?.[RUNTIME_MODES[i]]) return i;
    }
    return from;
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => step(i, 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => step(i, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const mode = RUNTIME_MODES[active];
      if (mode) pick(mode);
    }
  };

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        className="max-w-52"
        variant="ghost"
        type="button"
        data-access-picker-trigger
        title={`${RUNTIME_MODE_HINT[value]}${busy ? " Changes apply to the next turn." : ""}`}
        aria-label={RUNTIME_MODE_LABEL[value]}
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
      >
        <Icon
          className={`size-3.5 shrink-0 ${value === "full-access" ? "text-(--ui-tone-warning-fg)" : ""}`}
          strokeWidth={1.75}
        />
        <span className="min-w-0 truncate">{RUNTIME_MODE_LABEL[value]}</span>
        <ChevronDown
          className={`size-3 shrink-0 text-(--ui-text-secondary) ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </Button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={MENU_WIDTH}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="listbox"
          aria-label={t("Access")}
          aria-activedescendant={`${id}-${RUNTIME_MODES[active]}`}
          data-access-picker
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="p-1"
        >
          {RUNTIME_MODES.map((mode, index) => {
            const ModeIcon = ICONS[mode];
            const selected = mode === value;
            const reason = unavailable?.[mode];
            const highlighted = index === active && !reason;
            return (
              <Button
                className="w-full items-start py-2 text-start"
                fullWidth
                layout="inline"
                selected={highlighted}
                variant="item"
                key={mode}
                type="button"
                role="option"
                id={`${id}-${mode}`}
                tabIndex={-1}
                aria-selected={selected}
                aria-disabled={reason ? true : undefined}
                title={reason}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (!reason) setActive(index);
                }}
                onClick={() => pick(mode)}
              >
                <ModeIcon
                  aria-hidden="true"
                  className={`mbs-0.5 size-3.5 shrink-0 ${mode === "full-access" ? "text-(--ui-tone-warning-fg)" : "text-(--ui-text-secondary)"}`}
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-[13px] font-medium leading-5">
                    <span>{RUNTIME_MODE_LABEL[mode]}</span>
                    {selected ? (
                      <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
                    ) : null}
                  </span>
                  <span className="block text-[11px] font-normal leading-4 text-(--ui-text-secondary)">
                    {reason ? t("Unavailable: {p0}", { p0: reason }) : RUNTIME_MODE_HINT[mode]}
                  </span>
                </span>
              </Button>
            );
          })}
          {busy ? (
            <p className="mbs-1 border-bs border-(--ui-tone-neutral-border) px-2 py-2 text-[11px] font-normal leading-4 text-(--ui-text-secondary)">
              {t("Access changes apply to the next turn. Stop and resend to apply them now.")}
            </p>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}
