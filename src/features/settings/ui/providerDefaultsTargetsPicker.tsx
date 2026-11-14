import { useRef, useState } from "react";
import {
  PickerList,
  PickerFooter,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { ChevronDown, Globe } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import type { SearchableSelectOption } from "../../../shared/ui/SearchableSelect";

export function defaultsTargetsSummary(
  values: readonly string[],
  options: readonly SearchableSelectOption[],
) {
  if (!values.length || (values.length === 1 && values[0] === "global"))
    return t("Bycoda defaults");
  if (values.length === 1)
    return options.find((option) => option.value === values[0])?.label ?? t("Project overrides");
  const projects = options.filter(
    (option) => option.value.startsWith("project:") && !option.disabled,
  );
  if (
    !values.includes("global") &&
    values.length === projects.length &&
    projects.every((option) => values.includes(option.value))
  )
    return t("All projects ({p0})", { p0: projects.length });
  return values.includes("global")
    ? t("Bycoda defaults + {p0} overrides", { p0: values.length - 1 })
    : t("{p0} overrides", { p0: values.length });
}

/** App defaults are the ordinary scope; project/group overrides are an explicit separate choice. */
export function DefaultsTargetsPicker({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: SearchableSelectOption[];
  onChange: (values: string[]) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const hasOverrides = values.some((value) => value !== "global");
  const [mode, setMode] = useState(hasOverrides ? "projects" : "default");
  const available = options.filter((option) => !option.disabled && option.value !== "global");
  const sections = [...new Set(available.map((option) => option.group ?? ""))];
  const change = (next: string[]) => {
    const overrides = next.filter((value) => value !== "global");
    onChange(overrides.length ? overrides : ["global"]);
    setMode(overrides.length ? "projects" : "default");
  };
  const toggle = (entries: string[], checked: boolean) =>
    change(
      checked
        ? [...new Set([...values, ...entries])]
        : values.filter((value) => !entries.includes(value)),
    );
  const pickerOptions: PickerOption[] = sections
    .filter((section) => !group || section === group)
    .flatMap((section) => {
      const entries = available.filter(
        (option) =>
          (option.group ?? "") === section &&
          `${option.label} ${option.keywords ?? ""} ${option.meta ?? ""}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      );
      const keys = entries.map((option) => option.value);
      return [
        ...(section && entries.length
          ? [
              {
                value: `section:${section}`,
                title: t("Select all: {p0}", { p0: section }),
                group: section,
                onAction: () => toggle(keys, !keys.every((value) => values.includes(value))),
              },
            ]
          : []),
        ...entries.map((option) => ({
          value: option.value,
          title: option.label,
          icon: option.icon,
          meta: option.meta,
          group: section || undefined,
        })),
      ];
    });
  const list = usePickerList({
    options: pickerOptions,
    multiple: true,
    value: values.filter((value) => value !== "global"),
    onChange: change,
    inputRef: search,
    resetKey: `${open}:${query}:${group}:${mode}`,
  });
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        aria-label={t("Save in")}
        startIcon={<Globe className="icon-sm" />}
        endIcon={<ChevronDown className="icon-sm" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMode(hasOverrides ? "projects" : "default");
          setOpen(!open);
        }}
      >
        {defaultsTargetsSummary(values, options)}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          maxHeight={520}
          flow="auto"
          kind="dialog"
          aria-label={t("Apply defaults to")}
          onDismiss={() => setOpen(false)}
          className="provider-targets-popover"
        >
          <div className="p-2">
            <SegmentedControl
              label={t("Defaults scope")}
              value={mode}
              options={[
                { value: "default", label: t("Bycoda defaults") },
                { value: "projects", label: t("Project overrides") },
              ]}
              onValueChange={(next) => {
                setMode(next);
                if (next === "default") onChange(["global"]);
              }}
            />
          </div>
          {mode === "default" ? (
            <Text as="p" size="secondary" tone="secondary" wrap="normal" className="px-3 pb-3">
              {t("New conversations use these defaults unless a project has its own settings.")}
            </Text>
          ) : (
            <>
              <PopoverSearchHeader
                {...list.searchProps}
                label={t("Search projects, groups and workspaces")}
                value={query}
                onValueChange={setQuery}
              />
              <SegmentedControl
                label={t("Target categories")}
                value={group}
                onValueChange={setGroup}
                options={[
                  { value: "", label: t("All") },
                  ...sections.filter(Boolean).map((value) => ({ value, label: value })),
                ]}
              />
              <PickerList
                label={t("Apply defaults to")}
                controller={list}
                className="min-h-0 overflow-y-auto"
              />
            </>
          )}
          <PickerFooter align="between">
            {mode === "projects" ? (
              <Text size="caption" tone="secondary">
                {t("{p0} selected", { p0: values.filter((value) => value !== "global").length })}
              </Text>
            ) : null}
            <Button onClick={() => setOpen(false)} disabled={mode === "projects" && !hasOverrides}>
              {t("Done")}
            </Button>
          </PickerFooter>
        </Popover>
      ) : null}
    </>
  );
}
