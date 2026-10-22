import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../../src/shared/ui/Modal";
import { DateTimePicker } from "../../src/shared/ui/DateTimePicker";
import { SearchableSelect } from "../../src/shared/ui/SearchableSelect";
import { ColorPickerPopover } from "../../src/shared/ui/ColorPickerPopover";
import { NotificationMuteControl } from "../../src/features/notifications/ui/NotificationMuteControl";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("2028-02-20T18:30");
  const [choice, setChoice] = useState("alpha");
  const [color, setColor] = useState("#ff0000");
  if (new URLSearchParams(location.search).has("mute"))
    return (
      <main className="min-h-screen bg-background-base p-2 text-content">
        <NotificationMuteControl projectIds={["fixture-project"]} />
      </main>
    );
  return (
    <main className="min-h-screen bg-background-base p-6 text-content">
      <button onClick={() => setOpen(true)}>Open controls</button>
      <output data-testid="selected-choice">{choice}</output>
      {open ? (
        <Modal title="Shared controls" onClose={() => setOpen(false)} size="sm">
          <div className="flex min-w-0 flex-col gap-4 p-4">
            <DateTimePicker value={date} onChange={setDate} />
            <button onClick={() => setDate("2029-03-04T10:00")}>Change date externally</button>
            <SearchableSelect
              label="Choice"
              value={choice}
              options={[
                { value: "alpha", label: "Alpha" },
                { value: "beta", label: "Beta" },
              ]}
              onChange={setChoice}
            />
            <ColorPickerPopover value={color} onChange={setColor} />
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
void languageReady.then(() => createRoot(document.getElementById("root")!).render(<Fixture />));
