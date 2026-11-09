import type { ReactNode } from "react";
import { t } from "../../../shared/i18n/technical";
import { runtimeLogDetailsText } from "../runtimeLogsModel";
import { Disclosure } from "../../../shared/ui/Disclosure";

export function ObjectInspector({ value }: { value: unknown }) {
  const budget = { remaining: 160 };
  const seen = new WeakSet<object>();
  const render = (item: unknown, depth: number): ReactNode => {
    if (--budget.remaining < 0) return <code>…</code>;
    if (!item || typeof item !== "object") return <code>{runtimeLogDetailsText(item, 2_000)}</code>;
    if (seen.has(item)) return <code>[Circular]</code>;
    seen.add(item);
    if (depth >= 5) return <pre>{runtimeLogDetailsText(item, 3_000)}</pre>;
    const entries = Object.entries(item);
    return (
      <Disclosure
        defaultOpen={depth === 0}
        size="sm"
        className="runtime-log-object-node"
        summary={`${Array.isArray(item) ? t("Array") : t("Object")} (${entries.length})`}
      >
        <ul>
          {entries.slice(0, 30).map(([key, child]) => (
            <li key={key}>
              <code className="runtime-log-object-key">{key}:</code>
              {render(child, depth + 1)}
            </li>
          ))}
          {entries.length > 30 ? (
            <li>
              <code>…</code>
            </li>
          ) : null}
        </ul>
      </Disclosure>
    );
  };
  return <div className="runtime-log-object-tree">{render(value, 0)}</div>;
}
