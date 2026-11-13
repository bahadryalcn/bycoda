import { t } from "../../../shared/i18n/technical";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import type { DeviceInspection, DeviceSummary } from "../types";

/** Accessibility snapshot, node selection and explicit node action. */
export function DeviceInspector({
  inspection,
  platform,
  inspectionSearch,
  selectedNode,
  controlEnabled,
  canInspect,
  loading,
  onSearch,
  onSelect,
  onPressNode,
  onRefresh,
}: {
  inspection?: DeviceInspection;
  platform?: DeviceSummary["platform"];
  inspectionSearch: string;
  selectedNode: string;
  controlEnabled: boolean;
  canInspect: boolean;
  loading: boolean;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onPressNode: (inspectionId: string, nodeId: string) => void;
  onRefresh: () => void;
}) {
  const node = inspection?.nodes.find((value) => value.id === selectedNode);
  const filteredNodes =
    inspection?.nodes.filter((value) =>
      `${value.label} ${value.role} ${value.id}`
        .toLocaleLowerCase()
        .includes(inspectionSearch.toLocaleLowerCase()),
    ) ?? [];
  return (
    <div className="device-panel-inspector">
      <TextField
        label={t("Search accessibility nodes")}
        value={inspectionSearch}
        onChange={(event) => onSearch(event.target.value)}
      />
      <p className="host-tool-muted">
        {platform === "android"
          ? t(
              "Native accessibility snapshot · Point at the preview to inspect. Select a node, then press it explicitly.",
            )
          : t(
              "Native accessibility snapshot · Preview bounds unavailable for this coordinate space.",
            )}
      </p>
      {!inspection || inspection.supported === false ? (
        <p>{t("This device does not provide a structured accessibility tree.")}</p>
      ) : (
        <div
          {...surfaceAttributes({ frame: "stroke", edge: "block" }, "device-panel-nodes")}
          aria-label={t("Accessibility nodes")}
        >
          {filteredNodes.length ? (
            filteredNodes.slice(0, 500).map((value, index) => (
              <Button
                key={value.id}
                variant="item"
                selected={selectedNode === value.id}
                aria-pressed={selectedNode === value.id}
                onClick={() => onSelect(value.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const next =
                    filteredNodes[
                      Math.max(
                        0,
                        Math.min(
                          499,
                          filteredNodes.length - 1,
                          index + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      )
                    ];
                  if (next) {
                    onSelect(next.id);
                    const buttons =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        "button",
                      );
                    buttons?.[filteredNodes.indexOf(next)]?.focus();
                  }
                }}
              >
                <span className="device-panel-node-label">
                  {value.label || value.role || value.id}
                  <Text
                    size="micro"
                    tone="secondary"
                    leading="inherit"
                    className="device-panel-node-role"
                  >
                    {value.role}, {value.id}
                  </Text>
                </span>
              </Button>
            ))
          ) : (
            <EmptyState
              size="inline"
              kind="filtered"
              description={t("No matching accessibility nodes")}
            />
          )}
        </div>
      )}
      {node && (
        <Text
          as="div"
          size="caption"
          tone="inherit"
          leading="inherit"
          className="device-panel-node-detail"
        >
          <strong>{node.label || node.role}</strong>
          <span>
            {node.role}, {node.enabled ? t("Enabled") : t("Disabled")}
          </span>
          <span>
            {t("Bounds")}: {node.bounds.x}, {node.bounds.y}; {node.bounds.width} ×{" "}
            {node.bounds.height}
          </span>
          <Button
            disabled={!controlEnabled || !node.enabled || !node.clickable}
            onClick={() => {
              onPressNode(inspection!.inspectionId, node.id);
            }}
          >
            {t("Press selected node")}
          </Button>
        </Text>
      )}
      <Button
        variant="ghost"
        loading={loading}
        disabled={!controlEnabled || !canInspect}
        onClick={onRefresh}
      >
        {t("Refresh inspection")}
      </Button>
      {inspection?.raw && (
        <Disclosure size="sm" summary={t("Raw accessibility output")}>
          <OutputBlock
            size="micro"
            tone="primary"
            leading="inherit"
            className="device-panel-output"
          >
            {inspection.raw}
          </OutputBlock>
        </Disclosure>
      )}
    </div>
  );
}
