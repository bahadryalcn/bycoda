import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import {
  commitMessageParts,
  managementFields,
  type ManagementApprovalDetails,
} from "../model/managementApprovalDetails";

/** Owner-facing names of the most common operations; any other action keeps its exact ID. */
const ACTION_LABELS: Record<string, string> = {
  "git.commit": "Commit changes",
  "git.stage": "Stage files",
  "git.unstage": "Unstage files",
  "git.pull": "Pull changes",
  "git.push": "Push commits",
  "git.merge": "Merge branch",
  "git.stash": "Stash changes",
  "files.create": "Create file",
  "files.write": "Write file",
  "files.rename": "Rename file",
  "files.move": "Move file",
  "files.copy": "Copy file",
  "files.delete": "Delete file",
};

/** Heading for an application operation approval: its readable name, or the exact action ID. */
export function managementApprovalTitle(details: ManagementApprovalDetails) {
  return ACTION_LABELS[details.action] ?? "Application operation";
}

function FileContent({ value }: { value: unknown }) {
  const t = useT();
  if (typeof value !== "object" || value === null || !("preview" in value)) return null;
  const content = value as { preview?: unknown; truncated?: unknown; bytes?: unknown };
  if (typeof content.preview !== "string") return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <OutputBlock size="caption" frame="filled" scroll className="max-h-64 min-w-0">
        {content.preview}
      </OutputBlock>
      {content.truncated === true ? (
        <Text size="caption" tone="secondary">
          {t("Preview shortened; the exact request text lists the full size and digest.")}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * Application operation approval in readable form: where it applies, what changes, and the
 * commit message or file content as it will be written. Idempotency keys and revision guards
 * stay in the exact request text one click away.
 */
export function ManagementApprovalPreview({
  details,
  message,
}: {
  details: ManagementApprovalDetails;
  message: string;
}) {
  const t = useT();
  const { input, project } = details;
  const commit =
    details.action === "git.commit" && typeof input.message === "string"
      ? commitMessageParts(input.message)
      : undefined;
  const fileContent = details.action === "files.write" ? input.content : undefined;
  const fields = managementFields(input).filter(
    (field) =>
      !(commit && field.key === "message") &&
      !(fileContent !== undefined && field.key === "content"),
  );
  return (
    <Text as="div" size="body" tone="inherit" className="flex min-w-0 flex-col gap-3">
      {details.notice ? <Alert tone="warning">{details.notice}</Alert> : null}
      <DescriptionList size="sm">
        <DescriptionItem term={t("Project")} truncate={project.kind !== "path"} monospace>
          {project.kind === "path" ? (
            <MiddleTruncate mode="path" className="min-w-0">
              {project.value}
            </MiddleTruncate>
          ) : project.kind === "id" ? (
            project.value
          ) : (
            t("Application-wide")
          )}
        </DescriptionItem>
        <DescriptionItem term={t("Operation")} monospace>
          {details.action}
        </DescriptionItem>
        {fields
          .filter((field) => !field.multiline)
          .map((field) => (
            <DescriptionItem key={field.key} term={field.key} truncate monospace>
              {field.value}
            </DescriptionItem>
          ))}
      </DescriptionList>
      {commit ? (
        <section aria-label={t("Commit message")} className="flex min-w-0 flex-col gap-1">
          <Text as="strong" size="inherit" tone="inherit" wrap="anywhere">
            {commit.subject}
          </Text>
          {commit.body ? (
            <OutputBlock face="sans" size="caption" scroll className="max-h-48 min-w-0">
              {commit.body}
            </OutputBlock>
          ) : null}
        </section>
      ) : null}
      {fileContent !== undefined ? <FileContent value={fileContent} /> : null}
      {fields
        .filter((field) => field.multiline)
        .map((field) => (
          <section key={field.key} aria-label={field.key} className="flex min-w-0 flex-col gap-1">
            <Text size="caption" tone="secondary">
              {field.key}
            </Text>
            <OutputBlock size="caption" frame="filled" scroll className="max-h-48 min-w-0">
              {field.value}
            </OutputBlock>
          </section>
        ))}
      <Disclosure size="sm" summary={t("Exact request text")}>
        <OutputBlock size="caption" tone="secondary" className="break-words">
          {message}
        </OutputBlock>
      </Disclosure>
    </Text>
  );
}
