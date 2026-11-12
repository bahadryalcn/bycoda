import {
  PickerList,
  PickerFooter,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { useRef, useState } from "react";

import { t } from "../../../shared/i18n";

import { Button } from "../../../shared/ui/Button";

import { Popover } from "../../../shared/ui/Popover";

import { SegmentedControl } from "../../../shared/ui/SegmentedControl";

import { Badge } from "../../../shared/ui/Badge";

import { ChevronDown, Globe } from "../../../shared/ui/icons";

import { Text } from "../../../shared/ui/Text";

import type { SearchableSelectOption } from "../../../shared/ui/SearchableSelect";

export function defaultsTargetsSummary(
  values: readonly string[],
  options: readonly SearchableSelectOption[],
) {
  if (values.length === 1)
    return options.find((option) => option.value === values[0])?.label ?? t("Global");

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
    ? t("Global + {p0} targets", { p0: values.length - 1 })
    : t("{p0} targets", { p0: values.length });
}

/** One searchable membership picker. Empty selection falls back to Global. */

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

  const available = options.filter((option) => !option.disabled);

  const sections = [...new Set(options.map((option) => option.group ?? ""))];

  const change = (next: string[]) => onChange(next.length ? next : ["global"]);

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
    value: values,
    onChange: change,
    inputRef: search,
    resetKey: `${open}:${query}:${group}`,
  });

  return (
    <>
      <Button
        ref={anchor}
        variant="secondary"
        size="sm"
        aria-label={t("Save in")}
        startIcon={<Globe className="icon-sm" />}
        endIcon={<ChevronDown className="icon-sm" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {defaultsTargetsSummary(values, options)}
        {values.length > 1 ? <Badge size="sm">{values.length}</Badge> : null}
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
          <div className="grid shrink-0 gap-3">
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
                {
                  value: "",
                  label: t("All"),
                  accessory: <Badge size="sm">{available.length}</Badge>,
                },
                ...sections.filter(Boolean).map((value) => ({
                  value,
                  label: value,
                  accessory: (
                    <Badge size="sm">
                      {available.filter((option) => option.group === value).length}
                    </Badge>
                  ),
                })),
              ]}
            />

            <div className="provider-targets-quick">
              <Text size="caption" tone="muted">
                {t("Select:")}
              </Text>

              <Button size="sm" variant="ghost" onClick={() => change(["global"])}>
                {t("Global only")}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  change(
                    available
                      .filter((option) => option.value.startsWith("project:"))
                      .map((option) => option.value),
                  )
                }
              >
                {t("All projects")}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => change(available.map((option) => option.value))}
              >
                {t("Everything")}
              </Button>
            </div>
          </div>

          <PickerList
            label={t("Apply defaults to")}
            controller={list}
            className="min-h-0 overflow-y-auto"
          />

          <PickerFooter align="between">
            <Text size="caption" tone="secondary">
              {t("{p0} selected", { p0: values.length })}
            </Text>
            <Button variant="ghost" onClick={() => change(["global"])}>
              {t("Clear")}
            </Button>
            <Button onClick={() => setOpen(false)}>{t("Done")}</Button>
          </PickerFooter>

          {values.length > 1 ? (
            <Text size="caption" tone="muted">
              {t("Preview: {p0}", {
                p0: options.find((option) => option.value === values[0])?.label ?? t("Global"),
              })}
            </Text>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}
