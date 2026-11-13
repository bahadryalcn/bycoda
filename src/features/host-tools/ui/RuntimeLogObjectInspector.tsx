import { Code } from "../../../shared/ui/Code";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { ReactNode } from "react";
import { t } from "../../../shared/i18n/technical";
import { runtimeLogDetailsText } from "../runtimeLogsModel";
import { Disclosure } from "../../../shared/ui/Disclosure";

export function ObjectInspector({ value }: { value: unknown }) {
  const budget = { remaining: 160 };
  const seen = new WeakSet<object>();
  const render = (item: unknown, depth: number): ReactNode => {
    if (--budget.remaining < 0) return <Code>…</Code>;
    if (!item || typeof item !== "object") return <Code>{runtimeLogDetailsText(item, 2_000)}</Code>;
    if (seen.has(item)) return <Code>[Circular]</Code>;
    seen.add(item);
    if (depth >= 5)
      return (
        <OutputBlock size="micro" tone="inherit">
          {runtimeLogDetailsText(item, 3_000)}
        </OutputBlock>
      );
    const entries = Object.entries(item);
    return (
      <Disclosure
        defaultOpen={depth === 0}
        size="sm"
        textSize="micro"
        className="runtime-log-object-node"
        summary={
          <Code>{`${Array.isArray(item) ? t("Array") : t("Object")} (${entries.length})`}</Code>
        }
      >
        <ul {...surfaceAttributes({ frame: "stroke", edge: "inline-start" })}>
          {entries.slice(0, 30).map(([key, child]) => (
            <li key={key}>
              <Code tone="info">{key}:</Code>
              {render(child, depth + 1)}
            </li>
          ))}
          {entries.length > 30 ? (
            <li>
              <Code>…</Code>
            </li>
          ) : null}
        </ul>
      </Disclosure>
    );
  };
  return (
    <div {...surfaceAttributes({ frame: "stroke", radius: "control" }, "runtime-log-object-tree")}>
      {render(value, 0)}
    </div>
  );
}
