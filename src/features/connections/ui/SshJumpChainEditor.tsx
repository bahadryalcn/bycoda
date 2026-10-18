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
  const move = (index: number, offset: number) => {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" aria-label={t("Jump chain")}>
      {value.map((host, index) => (
        <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-1">
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
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  label={`${t("Move down")}: ${index + 1}`}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-3" />
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Remove jump host")}: ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="ghost"
        disabled={disabled || value.length >= MAX_SSH_JUMP_HOSTS}
        onClick={() => onChange([...value, ""])}
      >
        <Plus className="size-3" />
        {t("Add jump host")}
      </Button>
      {value.length > 1 ? (
        <p className="text-xs text-(--ui-text-muted)">
          {t("Connections follow this order. Each hop requires its own trusted host key.")}
        </p>
      ) : null}
    </div>
  );
}
