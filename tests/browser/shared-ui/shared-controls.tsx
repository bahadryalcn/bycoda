import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../../../src/shared/ui/Modal";
import { DateTimePicker } from "../../../src/shared/ui/DateTimePicker";
import { DatePicker } from "../../../src/shared/ui/DatePicker";
import { DateRangePicker, type DateRange } from "../../../src/shared/ui/DateRangePicker";
import { SearchableSelect } from "../../../src/shared/ui/SearchableSelect";
import { ColorPickerPopover } from "../../../src/shared/ui/ColorPickerPopover";
import { NotificationMuteControl } from "../../../src/features/notifications/ui/NotificationMuteControl";
import { languageReady } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

/** ?pickers: the three date pickers side by side in default, filled, error and disabled states. */
function PickersFixture() {
  const [day, setDay] = useState("2026-11-21");
  const [empty, setEmpty] = useState("");
  const [stamp, setStamp] = useState("2026-11-21T14:30");
  const [range, setRange] = useState<DateRange | null>({
    start: new Date(2026, 10, 3),
    end: new Date(2026, 10, 18),
  });
  return (
    <main className="min-h-screen bg-background-base p-6 text-content">
      <div data-pane="pickers" className="flex max-w-md min-w-0 flex-col gap-4">
        <DatePicker label="Due date" value={day} onChange={setDay} clearable />
        <DatePicker label="Start date" value={empty} onChange={setEmpty} placeholder="Pick a day" />
        <DatePicker
          label="Limited"
          value={day}
          onChange={setDay}
          min="2026-11-10"
          max="2026-11-28"
        />
        <DatePicker label="With error" value="" onChange={setEmpty} error="Choose a date." />
        <DatePicker label="Locked" value={day} onChange={setDay} disabled />
        <DateTimePicker label="Publish at" value={stamp} onChange={setStamp} />
        <DateRangePicker label="Reporting period" value={range} onChange={setRange} />
      </div>
    </main>
  );
}

function Fixture() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("2028-02-20T18:30");
  const [choice, setChoice] = useState("alpha");
  const [color, setColor] = useState("#ff0000");
  if (new URLSearchParams(location.search).has("pickers")) return <PickersFixture />;
  if (new URLSearchParams(location.search).has("mute"))
    return (
      <main className="min-h-screen bg-background-base p-2 text-content">
        <div data-pane="mute" className="min-w-0">
          <NotificationMuteControl projectIds={["fixture-project"]} />
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-background-base p-6 text-content">
      <button onClick={() => setOpen(true)}>Open controls</button>
      <output data-testid="selected-choice">{choice}</output>
      {open ? (
        <Modal title="Shared controls" onClose={() => setOpen(false)} size="sm">
          <div className="flex min-w-0 flex-col gap-4">
            <DateTimePicker
              label="Controlled date and time"
              hideLabel
              value={date}
              onChange={setDate}
            />
            <button onClick={() => setDate("2029-03-04T10:00")}>Change date externally</button>
            <SearchableSelect
              hideLabel
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
