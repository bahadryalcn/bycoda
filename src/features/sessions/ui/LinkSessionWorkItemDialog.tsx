import { Combobox, type ComboboxOption } from "../../../shared/ui/Combobox";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { searchWorkItemMentions } from "../../inbox/public/workItemMentions";
import type { LinkedWorkItem } from "../model/session";
import { linkedWorkItemFromInboxItem, parseGithubWorkItemUrl } from "../model/sessionWorkItem";

function parseLink(value: string) {
  return /^https?:\/\/github\.com\//i.test(value) && URL.canParse(value)
    ? parseGithubWorkItemUrl(value)
    : null;
}

export function LinkSessionWorkItemDialog({
  initial,
  cwd,
  sessionTitle,
  onSave,
  onClose,
}: {
  initial?: LinkedWorkItem;
  cwd: string;
  sessionTitle: string;
  onSave: (item: LinkedWorkItem | undefined) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [url, setUrl] = useState(initial?.url ?? "");
  const [draft, setDraft] = useState(initial?.url ?? "");
  const [result, setResult] = useState<{
    query: string;
    options: ComboboxOption[];
    failed?: boolean;
  }>();
  const [invalid, setInvalid] = useState(false);
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const query = draft.trim();
  const isUrl = /^(?:https?:|github\.com\/)/i.test(query);
  const currentResult = result?.query === query ? result : undefined;
  const options = currentResult?.options ?? [];

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- debounced Host search scoped to the project and query; aborts pending reads on change or close
  useEffect(() => {
    if (!cwd || cwd === "~" || isUrl) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchWorkItemMentions(cwd, ["github"], query, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return;
          const options = new Map<string, ComboboxOption>();
          const exactNumber = Number(/(?:^|[# !])(\d+)$/.exec(query)?.[1]);
          const ordered = [...items].sort(
            (a, b) =>
              Number(b.number === exactNumber) - Number(a.number === exactNumber) ||
              b.updatedAt.localeCompare(a.updatedAt),
          );
          for (const item of ordered) {
            const link = linkedWorkItemFromInboxItem(item);
            if (!link) continue;
            options.set(link.url, {
              value: link.url,
              label: `${item.kind === "pr" ? "PR" : t("Issue")} #${item.number} · ${item.title}`,
              keywords: [query],
            });
          }
          setResult({ query, options: [...options.values()].slice(0, 20) });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ query, options: [], failed: true });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cwd, isUrl, query, t]);

  const readLink = () => {
    const text = input.current?.value.trim() ?? url;
    const selected = options.find((option) => option.value === url);
    return parseLink(selected?.label === text ? url : text);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const item = readLink();
    if (!item) {
      setInvalid(true);
      return;
    }
    onSave(item);
  };

  return (
    <Modal
      title={initial ? t("Edit GitHub link") : t("Link GitHub issue or PR")}
      description={sessionTitle}
      size="sm"
      onClose={onClose}
      footer={
        <ModalActions
          start={
            initial ? (
              <Button variant="ghost" tone="danger" type="button" onClick={() => onSave(undefined)}>
                {t("Remove link")}
              </Button>
            ) : undefined
          }
        >
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" form={formId}>
            {initial ? t("Update link") : t("Link")}
          </Button>
        </ModalActions>
      }
    >
      <Text as="form" id={formId} onSubmit={submit} tone="inherit" className="flex flex-col gap-4">
        <Combobox
          ref={input}
          label={t("GitHub issue or pull request")}
          autoFocus
          allowCustomValue
          inlineSuggestions
          suggestCustomValue={(value) => Boolean(parseLink(value))}
          options={options}
          value={url}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${formId}-error` : undefined}
          placeholder={t("Search by title or number, or paste a URL")}
          emptyMessage={
            isUrl || !cwd || cwd === "~"
              ? t("Paste a GitHub issue or pull request URL.")
              : currentResult?.failed
                ? t("GitHub search unavailable. You can still paste a URL.")
                : currentResult
                  ? t("No results")
                  : t("Searching…")
          }
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            if (invalid) setInvalid(false);
          }}
          onValueChange={(value) => {
            setUrl(value);
            if (!value) setDraft("");
            if (invalid) setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || isImeComposition(event.nativeEvent)) return;
            if (event.currentTarget.hasAttribute("aria-activedescendant") || !readLink()) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        {invalid && (
          <InlineMessage id={`${formId}-error`} tone="danger">
            {t("Enter a valid GitHub issue or pull request URL.")}
          </InlineMessage>
        )}
      </Text>
    </Modal>
  );
}
