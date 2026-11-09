import { useLayoutEffect, useRef } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { ArrowDown, ArrowUp, Plus, X } from "../../../shared/ui/icons";
import { MAX_SSH_JUMP_HOSTS } from "../model/sshEndpointReview";

/** Ordered endpoint references only. Each hop uses the native SSH trust policy. */
export function SshJumpChainEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  // Stable row identities live beside the persisted string[]; they are never saved.
  const idsRef = useRef<number[]>([]);
  const nextIdRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ id: number; direction: -1 | 1 } | null>(null);
  const ids = idsRef.current;
  // Reconcile with external changes (reset, load) by length.
  while (ids.length < value.length) ids.push(nextIdRef.current++);
  if (ids.length > value.length) ids.length = value.length;

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-jump-row="${pending.id}"]`);
    const preferred = row?.querySelector<HTMLButtonElement>(
      `button[data-jump-move="${pending.direction}"]`,
    );
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-jump-move="${-pending.direction}"]`,
    );
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  });

  const move = (index: number, offset: -1 | 1) => {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    const moved = ids[index];
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    pendingFocus.current = { id: moved, direction: offset };
    onChange(next);
  };
  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-2" aria-label={t("Jump chain")}>
      {value.map((host, index) => (
        <div
          key={ids[index]}
          data-jump-row={ids[index]}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-1"
        >
          <TextField
            label={value.length === 1 ? t("Jump host") : `${t("Jump host")} ${index + 1}`}
            value={host}
            maxLength={512}
            disabled={disabled}
            placeholder="user@bastion:22"
            onChange={(event) =>
              onChange(value.map((entry, i) => (i === index ? event.target.value : entry)))
            }
          />
          <div className="flex gap-0.5">
            {value.length > 1 ? (
              <>
                <Button
                  variant="ghost"
                  iconOnly
                  label={`${t("Move up")}: ${index + 1}`}
                  disabled={disabled || index === 0}
                  data-jump-move={-1}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="icon-xs" />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  label={`${t("Move down")}: ${index + 1}`}
                  disabled={disabled || index === value.length - 1}
                  data-jump-move={1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="icon-xs" />
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Remove jump host")}: ${index + 1}`}
              disabled={disabled}
              onClick={() => {
                ids.splice(index, 1);
                onChange(value.filter((_, i) => i !== index));
              }}
            >
              <X className="icon-xs" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="ghost"
        disabled={disabled || value.length >= MAX_SSH_JUMP_HOSTS}
        onClick={() => onChange([...value, ""])}
      >
        <Plus className="icon-xs" />
        {t("Add jump host")}
      </Button>
      {value.length > 1 ? (
        <p className="text-ui-caption text-(--ui-text-muted)">
          {t("Connections follow this order. Each hop requires its own trusted host key.")}
        </p>
      ) : null}
    </div>
  );
}
