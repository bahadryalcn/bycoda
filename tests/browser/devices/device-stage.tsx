import { createRoot } from "react-dom/client";
import { useState } from "react";
import { DeviceBar } from "../../../src/features/devices/ui/DeviceBar";
import { DeviceWaitingState } from "../../../src/features/devices/ui/DeviceStageStates";
import "../../../src/styles/index.css";
import "../../../src/features/devices/DevicePanel.css";
const params = new URLSearchParams(location.search);
const light = params.get("theme") === "light";
document.documentElement.classList.toggle("theme-light", light);
const multi = params.has("multi");
// Loaded states beyond the default "Loading devices…": `?empty` (host running, no device),
// `?stopped` (one emulator to start), `?physical` (unplugged phone), `?waiting` (booted, no frame).
const empty = params.has("empty");
const stopped = params.has("stopped");
const physical = params.has("physical");
const waiting = params.has("waiting");
const loaded = multi || empty || stopped || physical || waiting;
const devices = [
  {
    id: "first",
    name: "First emulator",
    platform: "android" as const,
    version: "16",
    booted: false,
    physical: false,
  },
  {
    id: "second",
    name: "Second emulator",
    platform: "android" as const,
    version: "15",
    booted: false,
    physical: false,
  },
];
const single = stopped
  ? [devices[0]]
  : physical
    ? [{ ...devices[0], id: "phone", name: "Pixel 9 Pro", physical: true }]
    : waiting
      ? [{ ...devices[0], booted: true }]
      : [];
const visible = multi ? devices : single;
function Fixture() {
  const [selected, setSelected] = useState("");
  return (
    <main style={{ height: "100vh", display: "grid", placeItems: "center" }}>
      {!loaded && (
        <DeviceBar
          devices={[]}
          selected=""
          disabled
          loading
          discoveryFailed={false}
          refreshing
          refreshDisabled
          onSelect={() => {}}
          onRefresh={() => {}}
        />
      )}
      <DeviceWaitingState
        devices={visible}
        device={single[0] ?? devices.find((item) => item.id === selected)}
        selected={selected || (single[0]?.id ?? "")}
        loadingDevices={!loaded}
        error={false}
        live={false}
        facts={(item) => `Android ${item.version}`}
        booting={false}
        bootDisabled={false}
        refreshing={false}
        refreshDisabled={false}
        onBoot={() => {}}
        onRefresh={() => {}}
        onSetup={() => {}}
        onSelect={(id) => setSelected(id)}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
