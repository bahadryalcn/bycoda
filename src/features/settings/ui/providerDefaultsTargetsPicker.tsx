import { useRef, useState } from "react";

import { t } from "../../../shared/i18n";

import { Button } from "../../../shared/ui/Button";

import { Checkbox } from "../../../shared/ui/Checkbox";

import { Popover } from "../../../shared/ui/Popover";

import { SearchInput } from "../../../shared/ui/SearchInput";

import { SegmentedControl } from "../../../shared/ui/SegmentedControl";

import { Badge } from "../../../shared/ui/Badge";

import { ChevronDown, Globe, Search } from "../../../shared/ui/icons";

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
          onKeyDown={(event) => {
            if (event.defaultPrevented) return;
            if (
              event.key === "ArrowDown" &&
              event.target instanceof HTMLInputElement &&
              event.target.type !== "checkbox"
            ) {
              event.preventDefault();
              event.currentTarget
                .querySelector<HTMLInputElement>(".provider-targets-list input")
                ?.focus();
            } else if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !(event.target instanceof HTMLInputElement && event.target.type !== "checkbox")
            ) {
              event.preventDefault();
              setQuery((current) => current + event.key);
              event.currentTarget
                .querySelector<HTMLInputElement>(".provider-target-search input")
                ?.focus();
            }
          }}
        >
          <div className="provider-targets-tools">
            <div className="provider-target-search">
              <Search className="icon-sm" />
              <SearchInput
                appearance="field"
                placeholder={t("Search projects, groups and workspaces")}
                aria-label={t("Search projects, groups and workspaces")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

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

          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Delegates arrow keys between native checkboxes; this wrapper is not a focus target. */}
          <div
            className="provider-targets-list"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

              const inputs = [
                ...event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
              ];

              const current = inputs.indexOf(document.activeElement as HTMLInputElement);

              const next =
                inputs[
                  (current + (event.key === "ArrowDown" ? 1 : -1) + inputs.length) % inputs.length
                ];

              if (next) {
                event.preventDefault();
                next.focus();
              }
            }}
          >
            {sections
              .filter((section) => !group || section === group)
              .map((section) => {
                const entries = available.filter(
                  (option) =>
                    (option.group ?? "") === section &&
                    `${option.label} ${option.keywords ?? ""} ${option.meta ?? ""}`
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()),
                );

                if (!entries.length) return null;

                const keys = entries.map((option) => option.value);

                const selected = keys.filter((value) => values.includes(value)).length;

                return (
                  <div key={section} className="provider-targets-section">
                    {section ? (
                      <Checkbox
                        className="provider-target-row"
                        size="caption"
                        tone="muted"
                        aria-label={t("Select all: {p0}", { p0: section })}
                        label={`${section} · ${keys.length}`}
                        checked={selected === keys.length}
                        indeterminate={selected > 0 && selected < keys.length}
                        onChange={(event) => toggle(keys, event.target.checked)}
                      />
                    ) : null}

                    {entries.map((option) => (
                      <Checkbox
                        className="provider-target-row"
                        size="secondary"
                        key={option.value}
                        label={
                          <span className="provider-target-label">
                            {option.icon}
                            <Text as="span" size="secondary">
                              {option.label}
                            </Text>
                            <Text size="caption" tone="muted">
                              {option.meta}
                            </Text>
                          </span>
                        }
                        checked={values.includes(option.value)}
                        onChange={(event) => toggle([option.value], event.target.checked)}
                      />
                    ))}
                  </div>
                );
              })}
          </div>

          <div className="provider-targets-footer">
            <Text size="caption" tone="secondary">
              {t("{p0} selected", { p0: values.length })}
            </Text>
            <Button variant="ghost" onClick={() => change(["global"])}>
              {t("Clear")}
            </Button>
            <Button onClick={() => setOpen(false)}>{t("Done")}</Button>
          </div>

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
