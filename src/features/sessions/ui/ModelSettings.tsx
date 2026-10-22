import { MorphSelect } from "../../../shared/ui/MorphSelect";
import { Button } from "../../../shared/ui/Button";
import { AiIdea, Gauge, Zap } from "../../../shared/ui/icons";
import { useEffect, useMemo, useState } from "react";

import {
  getModelSnapshot,
  resolveModel,
  subscribeModels,
  type ModelSetting,
} from "../model/models";
import type { HarnessId } from "../model/session";

type Props = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
};

export function ModelSettings({ harness, model, values, onChange, onClose }: Props) {
  const catalog = useSyncCatalog();
  const settings = useMemo(() => {
    void catalog;
    const list = (resolveModel(harness, model).settings ?? []).filter(
      (setting) => !(harness === "opencode" && setting.id === "agent"),
    );
    const order = ["variant", "agent", "effort", "reasoning", "thinking", "fast", "context"];
    return [...list].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [catalog, harness, model]);

  if (settings.length === 0) return null;

  const setValue = (id: string, value: string) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <>
      {settings.map((setting) =>
        setting.kind === "toggle" ? (
          <ToggleSetting
            key={setting.id}
            setting={setting}
            value={values[setting.id] ?? setting.value}
            onChange={(value) => setValue(setting.id, value)}
          />
        ) : (
          <SelectSetting
            key={setting.id}
            setting={setting}
            value={values[setting.id] ?? setting.value}
            onChange={(value) => setValue(setting.id, value)}
            onClose={onClose}
          />
        ),
      )}
    </>
  );
}

function useSyncCatalog(): number {
  const [version, setVersion] = useState(getModelSnapshot);
  useEffect(() => subscribeModels(() => setVersion(getModelSnapshot())), []);
  return version;
}

function ToggleSetting({
  setting,
  value,
  onChange,
}: {
  setting: ModelSetting;
  value: string;
  onChange: (value: string) => void;
}) {
  const on = value === "true";
  const Icon = setting.id === "fast" ? Zap : setting.id === "thinking" ? AiIdea : Gauge;
  return (
    <Button
      variant="ghost"
      type="button"
      title={setting.description ?? setting.label}
      aria-label={setting.label}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChange(on ? "false" : "true")}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="text-[11px]">{setting.label}</span>
    </Button>
  );
}

function SelectSetting({
  setting,
  value,
  onChange,
  onClose,
}: {
  setting: ModelSetting;
  value: string;
  onChange: (value: string) => void;
  onClose?: () => void;
}) {
  return (
    <MorphSelect
      label={setting.label}
      value={value}
      options={setting.options.map((option) => ({ value: option.value, label: option.label }))}
      onChange={onChange}
      onClose={onClose}
      triggerProps={{
        title: setting.description ?? setting.label,
        onMouseDown: (event) => event.preventDefault(),
      }}
    />
  );
}
