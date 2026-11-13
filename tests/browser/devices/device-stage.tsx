import { createRoot } from "react-dom/client";
import { useState } from "react";
import { DeviceWaitingState } from "../../../src/features/devices/ui/DeviceStageStates";
import "../../../src/styles/index.css";
import "../../../src/features/devices/DevicePanel.css";
const light = new URLSearchParams(location.search).get("theme") === "light";
document.documentElement.classList.toggle("theme-light", light);
const multi = new URLSearchParams(location.search).has("multi");
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
function Fixture() {
  const [selected, setSelected] = useState("");
  return (
    <main style={{ height: "100vh", display: "grid", placeItems: "center" }}>
      <DeviceWaitingState
        devices={multi ? devices : []}
        device={devices.find((item) => item.id === selected)}
        selected={selected}
        loadingDevices={!multi}
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
