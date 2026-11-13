import { ActionHost, actionContentAttributes } from "../../../src/shared/ui/ActionHost";
import { Button } from "../../../src/shared/ui/Button";
export function ControlLayoutFixture() {
  return (
    <main style={{ maxWidth: 720, padding: 16, display: "grid", gap: 12 }}>
      <ActionHost data-layout-case="rail" controlHeight="compact" padding={{ inline: "md" }}>
        Rail row
      </ActionHost>
      <ActionHost data-layout-case="recovery" padding={{ block: "md" }}>
        Recovery row
      </ActionHost>
      {(["compact", "regular", "expanded-compact", "expanded-regular"] as const).map((mode) => (
        <ActionHost
          key={mode}
          data-layout-case={mode}
          padding={{
            inline: "lg",
            top: mode.endsWith("compact") ? "xs" : "sm",
            bottom: mode.startsWith("expanded") ? "lg" : mode === "compact" ? "xs" : "sm",
          }}
        >
          Conversation {mode}
        </ActionHost>
      ))}
      <Button
        data-layout-case="folder"
        variant="item"
        size="sm"
        padding={{ inline: "lg", block: "xs" }}
      >
        Folder header
      </Button>
      <Button data-layout-case="group" variant="ghost" size="sm" padding={{ start: "xs" }}>
        Workspace name
      </Button>
      <Button data-layout-case="project" variant="item" padding={{ start: "xs", end: "none" }}>
        Project name
      </Button>
      <Button
        data-layout-case="reconnect"
        variant="item"
        padding={{ start: "xs", end: "none" }}
        reserveEndAction="inline"
      >
        Project with reconnect
      </Button>
      <Button data-layout-case="tab" variant="tab" reserveEndAction="control">
        Closable tab
      </Button>
      <Button data-layout-case="tab-open" variant="tab">
        Tab without close action
      </Button>
      <Button
        data-layout-case="icon"
        iconOnly
        iconTarget="compact"
        label="Expand group"
        motion="none"
      >
        +
      </Button>
      <Button
        data-layout-case="content"
        controlHeight="content"
        padding={{ inline: "xl", block: "xxs" }}
      >
        Content height
      </Button>
      <Button data-layout-case="auto" controlHeight="auto">
        Auto retains minimum
      </Button>
      <div style={{ height: 64 }}>
        <Button data-layout-case="fill" controlHeight="fill">
          Fill row
        </Button>
      </div>
      <ActionHost data-layout-case="minimum" controlMinHeight="control">
        <span style={{ height: 72 }}>Multi-line row</span>
      </ActionHost>
      <ActionHost data-layout-case="swap" hoverReveal>
        <Button motion="none">Swap main</Button>
        <span {...actionContentAttributes({ phase: "rest", hide: "visibility" })}>
          <Button motion="none">Rest child</Button>
        </span>
        <span {...actionContentAttributes({ phase: "interaction", display: "flex" })}>
          <Button motion="none">Active child</Button>
        </span>
        <span {...actionContentAttributes({ phase: "rest", hide: "screen-reader" })}>
          Status preserved
        </span>
      </ActionHost>
      <ActionHost data-layout-case="settings" variant="settings" separator>
        <Button variant="primary" motion="none">
          Settings save
        </Button>
        <input aria-label="Fixture draft" defaultValue="Draft" />
      </ActionHost>
      <ActionHost data-layout-case="settings-peer" variant="settings" separator>
        Another settings row
      </ActionHost>
      <Button
        data-layout-case="touch"
        iconOnly
        iconTarget="compact"
        touchTarget="control"
        label="Touch target"
        motion="none"
      >
        +
      </Button>
    </main>
  );
}
