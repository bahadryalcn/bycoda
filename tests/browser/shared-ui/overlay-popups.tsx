import { useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../../src/shared/ui/Button";
import { RailToolGroup } from "../../../src/app/shell/RailToolGroup";
import { ConfirmDialog } from "../../../src/shared/ui/ConfirmDialog";
import { Modal } from "../../../src/shared/ui/Modal";
import { NativePopupHost } from "../../../src/shared/ui/NativePopupHost";
import { Popover } from "../../../src/shared/ui/Popover";
import { TextField } from "../../../src/shared/ui/TextField";
import { FilterTrigger } from "../../../src/shared/ui/FilterTrigger";
import { Plus, Settings, SlidersHorizontal } from "../../../src/shared/ui/icons";
import { GitGraphColumnFilter } from "../../../src/features/source-control/ui/GitGraphColumnFilter";
import {
  EMPTY_HISTORY_FILTERS,
  type GitHistoryFilters,
} from "../../../src/features/source-control/model/gitHistoryFilters";
import "../../../src/styles/index.css";

// Memory-only overlay fixture. Nothing here reaches a Host, account, clipboard or
// preference. It is fixture evidence for the shared overlay stack, not native
// or installed acceptance.

const ITEMS = Array.from({ length: 40 }, (_, index) => `Branch feature/overlay-${index + 1}`);
const PARAGRAPHS = Array.from(
  { length: 14 },
  (_, index) =>
    `Paragraph ${index + 1}. Long dialog bodies must scroll inside the dialog while the header and the footer actions stay fixed and reachable at short viewport heights.`,
);

declare global {
  interface Window {
    __overlayLog: string[];
    __resolveConfirm?: () => void;
    __rejectConfirm?: (message: string) => void;
  }
}
window.__overlayLog = [];
const log = (entry: string) => window.__overlayLog.push(entry);

function Workbench({ children }: { children?: ReactNode }) {
  return (
    <div className="bg-background-base text-content flex min-h-screen flex-col" data-workbench>
      <header className="border-stroke flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <strong className="text-ui-title">Workbench</strong>
        {children}
      </header>
      <main className="grid flex-1 grid-cols-[220px_1fr_260px] max-[700px]:grid-cols-1">
        <aside className="border-stroke bg-(--ui-surface) border-e p-3 max-[700px]:hidden">
          {Array.from({ length: 12 }, (_, index) => (
            <p key={index} className="text-ui-secondary py-1 text-(--ui-text-secondary)">
              packages/shared/file-{index}.ts
            </p>
          ))}
        </aside>
        <section className="p-4">
          <h1 className="text-ui-heading mb-2">Session transcript</h1>
          {Array.from({ length: 16 }, (_, index) => (
            <p key={index} className="text-ui-body mb-2 text-(--ui-text-secondary)">
              Work beneath the overlay line {index + 1}: the agent edited a file and ran the project
              checks without a failure.
            </p>
          ))}
        </section>
        <aside className="border-stroke bg-(--ui-surface) border-s p-3 max-[700px]:hidden">
          <p className="text-ui-caption">Source control</p>
          {Array.from({ length: 10 }, (_, index) => (
            <p key={index} className="text-ui-secondary py-1">
              M src/feature-{index}.tsx
            </p>
          ))}
        </aside>
      </main>
    </div>
  );
}

function BoundedPopover({ mode }: { mode: "scroll" | "intrinsic" | "clip" | "hard-clip" }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <Button
        ref={anchor}
        variant="secondary"
        data-testid={`popover-${mode}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {`Popover ${mode}`}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          role="dialog"
          aria-label={`${mode} popover`}
          data-testid="popover-surface"
          flow={mode === "scroll" ? "scroll" : mode === "hard-clip" ? "intrinsic" : undefined}
          width={280}
          maxHeight={mode === "intrinsic" ? undefined : 320}
          onDismiss={(reason) => {
            log(`popover-dismiss:${reason}`);
            setOpen(false);
          }}
        >
          {mode === "intrinsic" ? (
            <div className="flex flex-col gap-2 p-3">
              <strong className="text-ui-secondary">Compact options</strong>
              <p className="text-ui-caption text-(--ui-text-secondary)">
                Intrinsic content keeps its natural height.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setClicks((v) => v + 1)}>
                {`Apply (${clicks})`}
              </Button>
            </div>
          ) : (
            <ul className="p-1" data-testid="popover-list">
              {ITEMS.map((item) => (
                <li key={item}>
                  <Button variant="ghost" layout="item" size="sm" className="w-full">
                    {item}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      ) : null}
    </>
  );
}

function ModalScene({
  size,
  placement,
  onClose,
  nested = false,
}: {
  size: "sm" | "md" | "lg";
  placement?: "center" | "end";
  onClose: () => void;
  nested?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Modal
      size={size}
      placement={placement}
      title={placement === "end" ? "Background session" : `Dialog ${size}`}
      description={placement === "end" ? undefined : "A bounded task dialog with a fixed footer."}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="ms-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary">Save changes</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="modal-body">
        <TextField label="Name" defaultValue="overlay" />
        {nested ? (
          <>
            <Button
              ref={anchor}
              variant="secondary"
              data-testid="nested-trigger"
              onClick={() => setOpen((value) => !value)}
            >
              Choose branch
            </Button>
            {open ? (
              <Popover
                anchor={anchor}
                role="dialog"
                aria-label="Branches"
                flow="scroll"
                width={260}
                maxHeight={200}
                autoFocus
                tabIndex={-1}
                onDismiss={(reason) => {
                  log(`nested-dismiss:${reason}`);
                  setOpen(false);
                }}
              >
                <ul className="p-1">
                  {ITEMS.slice(0, 12).map((item) => (
                    <li key={item}>
                      <Button variant="ghost" layout="item" size="sm" className="w-full">
                        {item}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Popover>
            ) : null}
          </>
        ) : null}
        {PARAGRAPHS.map((text) => (
          <p key={text} className="text-ui-secondary text-(--ui-text-secondary)">
            {text}
          </p>
        ))}
      </div>
    </Modal>
  );
}

function ConfirmScene({ kind, onSettle }: { kind: string; onSettle: (value: boolean) => void }) {
  const attempts = useRef(0);
  return (
    <ConfirmDialog
      request={{
        title: kind === "plain" ? "Delete branch?" : "Delete 3 worktrees?",
        message:
          "This removes the worktree directories from disk. Uncommitted changes in them are lost.",
        confirmLabel: "Delete",
        danger: kind !== "neutral",
        onConfirm:
          kind === "plain" || kind === "neutral"
            ? undefined
            : () =>
                new Promise<void>((resolve, reject) => {
                  attempts.current += 1;
                  log(`confirm-call:${attempts.current}`);
                  if (kind === "error" && attempts.current === 1) {
                    window.__rejectConfirm = (message) => reject(new Error(message));
                  } else {
                    window.__resolveConfirm = resolve;
                  }
                }),
      }}
      onSettle={onSettle}
    />
  );
}

// Shared FilterTrigger + Popover pattern. The Social screens no longer wrap it
// (the Social filter popover was removed with the old UI); the fixture keeps the
// same copy and focus-return behavior that overlay-popups.spec.ts asserts.
function Filters() {
  const [git, setGit] = useState<GitHistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const activeCount = kind === "all" ? 0 : 1;
  return (
    <>
      <FilterTrigger
        ref={anchor}
        type="button"
        size="sm"
        label={activeCount ? "Filters · 1 active" : "Filters"}
        icon={<SlidersHorizontal className="icon-sm" aria-hidden="true" />}
        activeCount={activeCount}
        onReset={() => setKind("all")}
        resetLabel="Reset filters"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <Popover
          anchor={anchor}
          align="end"
          width={300}
          role="dialog"
          aria-label="Filters"
          flow="scroll"
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") anchor.current?.focus();
          }}
        >
          <div>
            <strong>Filters</strong>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!activeCount}
              onClick={() => setKind("all")}
            >
              Reset
            </Button>
          </div>
          <TextField label="Kind" value={kind} onChange={(event) => setKind(event.target.value)} />
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </Popover>
      ) : null}
      <GitGraphColumnFilter label="Author" field="author" filters={git} onChange={setGit} />
      <GitGraphColumnFilter label="Date" field="date" filters={git} onChange={setGit} />
    </>
  );
}

function NativeHostScene() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [popover, setPopover] = useState(false);
  const [modal, setModal] = useState(false);
  return (
    <>
      <div
        ref={setHost}
        data-testid="native-host"
        className="border-stroke relative h-[320px] w-[360px] overflow-hidden rounded-lg border"
      />
      <NativePopupHost.Provider value={host}>
        <Button
          ref={anchor}
          variant="secondary"
          data-testid="native-popover"
          onClick={() => setPopover(true)}
        >
          Native popover
        </Button>
        <Button variant="secondary" data-testid="native-modal" onClick={() => setModal(true)}>
          Native modal
        </Button>
        {host && popover ? (
          <Popover
            anchor={anchor}
            role="dialog"
            aria-label="Native popover"
            flow="scroll"
            maxHeight={200}
            onDismiss={() => setPopover(false)}
          >
            <ul className="p-1">
              {ITEMS.slice(0, 14).map((item) => (
                <li key={item} className="text-ui-secondary px-2 py-1">
                  {item}
                </li>
              ))}
            </ul>
          </Popover>
        ) : null}
        {host && modal ? (
          <Modal
            size="sm"
            title="Native dialog"
            onClose={() => setModal(false)}
            footer={<Button variant="primary">Save</Button>}
          >
            <p className="text-ui-secondary">Routed into the native popup host element.</p>
          </Modal>
        ) : null}
      </NativePopupHost.Provider>
    </>
  );
}

function OverlayAcceptance() {
  const [active, setActive] = useState(0);
  const [child, setChild] = useState(false);
  const [parent, setParent] = useState(false);
  return (
    <div data-testid="overlay-acceptance" className="w-64">
      <RailToolGroup
        label="Acceptance tools"
        tools={["Files", "Settings"].map((label, index) => ({
          id: label,
          label,
          icon: index ? <Settings /> : <Plus />,
          active: active === index,
          dot: "Unseen items",
          onSelect: () => setActive(index),
        }))}
      />
      <Button
        data-testid="open-modal-pair"
        onClick={() => {
          setChild(true);
          setParent(true);
        }}
      >
        Open nested dialogs
      </Button>
      {parent ? (
        <Modal title="Parent dialog" size="lg" onClose={() => setParent(false)}>
          <TextField label="Parent field" />
          <p>Parent dialog content remains beneath the child's blur.</p>
          <Button data-testid="reopen-child" onClick={() => setChild(true)}>
            Open child
          </Button>
          {child ? (
            <Modal title="Child dialog" onClose={() => setChild(false)}>
              <TextField label="Child field" />
              <Button variant="primary">Child action</Button>
            </Modal>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

function App() {
  const [scene, setScene] = useState<string | null>(
    new URLSearchParams(location.search).get("scene"),
  );
  const [lastSettle, setLastSettle] = useState("none");
  const close = () => {
    log(`close:${scene}`);
    setScene(null);
  };
  const open = (name: string) => (
    <Button
      key={name}
      variant="secondary"
      size="sm"
      data-testid={`open-${name}`}
      onClick={() => setScene(name)}
    >
      {name}
    </Button>
  );
  const modalScene =
    scene === "modal-sm" ? (
      <ModalScene size="sm" onClose={close} />
    ) : scene === "modal-md" ? (
      <ModalScene size="md" onClose={close} />
    ) : scene === "modal-lg" ? (
      <ModalScene size="lg" onClose={close} />
    ) : scene === "sheet" ? (
      <ModalScene size="md" placement="end" onClose={close} />
    ) : scene === "nested" ? (
      <ModalScene size="md" nested onClose={close} />
    ) : scene?.startsWith("confirm-") ? (
      <ConfirmScene
        kind={scene.slice("confirm-".length)}
        onSettle={(value) => {
          setLastSettle(String(value));
          log(`settle:${value}`);
          setScene(null);
        }}
      />
    ) : null;
  return (
    <Workbench>
      <OverlayAcceptance />
      {[
        "modal-sm",
        "modal-md",
        "modal-lg",
        "sheet",
        "nested",
        "confirm-plain",
        "confirm-pending",
        "confirm-error",
      ].map(open)}
      <BoundedPopover mode="scroll" />
      <BoundedPopover mode="clip" />
      <BoundedPopover mode="hard-clip" />
      <BoundedPopover mode="intrinsic" />
      <Button variant="ghost" iconOnly label="Project settings" data-testid="tooltip-icon">
        <Settings />
      </Button>
      <Button variant="ghost" iconOnly label="Add item" data-testid="tooltip-icon-2">
        <Plus />
      </Button>
      <Filters />
      <span data-testid="last-settle" className="text-ui-caption text-(--ui-text-muted)">
        {lastSettle}
      </span>
      {modalScene}
      {scene === "native" ? <NativeHostScene /> : null}
      <Button
        variant="secondary"
        size="sm"
        data-testid="open-native"
        onClick={() => setScene("native")}
      >
        native
      </Button>
    </Workbench>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
