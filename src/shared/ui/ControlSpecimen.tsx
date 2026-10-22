import { Button, type ButtonTone } from "./Button";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";
import { t, useLocale } from "../i18n";
import { useRef, useState } from "react";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { Slider } from "./Slider";
import { SegmentedControl } from "./SegmentedControl";
import { Popover } from "./Popover";
import { Badge } from "./Badge";
import { Alert } from "./Alert";
import { Progress } from "./Progress";
import { Skeleton } from "./Skeleton";
import { NumberField } from "./NumberField";
import { PasswordField } from "./PasswordField";
import { RadioGroup } from "./RadioGroup";
import { TagInput } from "./TagInput";
import { NativeSearchableSelect } from "./NativeSearchableSelect";
import { Checkbox } from "./Checkbox";

/** Local-only control samples. Appearance and browser checks share these adapters. */
export function ControlSpecimen({ expanded = false }: { expanded?: boolean }) {
  useLocale();
  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState("compact");
  const [amount, setAmount] = useState(50);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);
  const choices = [
    { value: "compact", label: t("Compact") },
    { value: "comfortable", label: t("Comfortable") },
  ];
  const tones: ButtonTone[] = ["neutral", "accent", "info", "success", "warning", "danger"];
  return (
    <section aria-label={t("Control preview")} className="grid min-w-0 gap-3">
      {expanded ? (
        (["primary", "secondary", "ghost", "link"] as const).map((variant) => (
          <div key={variant} className="flex min-w-0 flex-wrap items-center gap-2">
            {tones.map((tone) => (
              <Button key={tone} variant={variant} tone={tone} motion="none">
                {variant} / {tone}
              </Button>
            ))}
          </div>
        ))
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="primary">{t("Save")}</Button>
          <Button>{t("Cancel")}</Button>
          <Button variant="ghost" tone="danger">
            {t("Delete")}
          </Button>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button selected aria-pressed="true">
          {t("Selected")}
        </Button>
        <Button disabled>{t("Unavailable")}</Button>
        <Button loading loadingLabel={t("Saving…")}>
          {t("Save")}
        </Button>
      </div>
      <TextField label={t("Name")} defaultValue={t("Control preview")} />
      <TextareaField label={t("Description")} rows={2} />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Select label={t("Preview")} value={value} options={choices} onValueChange={setValue} />
        <Switch label={t("Enabled")} checked={enabled} onCheckedChange={setEnabled} />
        <Button
          ref={anchor}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t("Details")}
        </Button>
      </div>
      <SegmentedControl
        label={t("Layout")}
        value={value}
        options={choices}
        onValueChange={setValue}
      />
      <Slider label={t("Preview")} value={amount} onValueChange={setAmount} min={0} max={100} />
      {expanded ? <TextField label={t("Required")} error={t("Required")} required /> : null}
      {expanded ? (
        <div className="grid min-w-0 gap-3">
          <NativeSearchableSelect
            label={t("Layout")}
            options={choices}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
          <NumberField label={t("Preview")} defaultValue={50} min={0} max={100} />
          <PasswordField label={t("Password")} defaultValue="preview" autoComplete="off" />
          <RadioGroup
            label={t("Preview")}
            defaultValue="selected"
            compact
            options={[
              { value: "selected", label: t("Selected") },
              { value: "unavailable", label: t("Unavailable"), disabled: true },
            ]}
          />
          <TagInput
            label={t("Tags")}
            placeholder={t("Add tag…")}
            value={tags}
            onValueChange={setTags}
            removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
          />
          <label className="flex items-center gap-2">
            <Checkbox defaultChecked />
            {t("Preview")}
          </label>
          <div className="flex min-w-0 flex-wrap gap-2">
            {(["neutral", "info", "success", "warning", "danger"] as const).map((tone) => (
              <Badge key={tone} tone={tone}>
                {t("Preview")}
              </Badge>
            ))}
          </div>
          <Alert tone="info">{t("Preview")}</Alert>
          <Progress label={t("Progress")} value={amount} />
          <Skeleton lines={2} label={t("Loading…")} />
        </div>
      ) : null}
      {open ? (
        <Popover
          anchor={anchor}
          role="dialog"
          aria-label={t("Control preview")}
          onDismiss={() => {
            setOpen(false);
            anchor.current?.focus({ preventScroll: true });
          }}
        >
          <div className="grid gap-2 p-3">
            <span>{t("Preview")}</span>
            <Button
              onClick={() => {
                setOpen(false);
                anchor.current?.focus({ preventScroll: true });
              }}
            >
              {t("Close")}
            </Button>
          </div>
        </Popover>
      ) : null}
    </section>
  );
}
