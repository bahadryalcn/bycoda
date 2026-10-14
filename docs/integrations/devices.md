# Host devices

## Devices

Create one `DeviceHost(hostStateDir, { nodePath?, npmCliPath? })` per host. The default uses the current Node runtime and npm's JS CLI beside it. Packaged runtimes without npm return an explicit setup error; configure a genuine Node/npm toolchain path. Setup never launches shell command strings or visible windows.

Expose authenticated RPC: `devices.status`, `devices.setup({ agentAccess })`, `devices.start`, `devices.stop`, `devices.list`, `devices.boot({ deviceId })`, `devices.capture({ deviceId })`, `devices.action({ deviceId, action })`. Every operation requires paired-host authentication; supplied project IDs are validated. Explicit machine tools omit foreign project/session IDs. Setup/start/stop/control are privileged mutations. When exposing tools to providers, derive their context from the active agent run. `DevicePanel` expects injected callbacks matching `DevicePanelApi`.

Setup is an explicit UI action: installs `expo-device-hub@0.12.0` and optionally `agent-device@0.21.23` into private host tool caches, preserving dependency license files. Installs stage in separate directories and become usable only after successful completion plus a marker. Existing/partial directories are retained rather than destructively cleaned. Node 22.12+, Android SDK/AVDs or Mac Xcode/simulator runtimes must already exist. SDK detection does not prove a runtime is installed; device discovery returns the concrete SDK errors. Packaged hosts also search their shared runtime parent for npm's JS CLI.

The host supplies detected Android SDK binary paths to its child processes. On a Mac with `/Applications/Xcode.app`, it supplies `DEVELOPER_DIR` when no explicit override exists, so an active CommandLineTools selection does not prevent simulator access. This does not change the system-wide `xcode-select` setting. iOS support requires a successful `xcrun --find simctl` probe; merely having `xcrun` is insufficient.

Native Mac discovery includes available iOS simulators that have never been used, which the hub's recent-device list omits. Native Windows discovery uses `emulator.exe -list-avds` and `adb.exe devices`, avoiding the hub's incompatible `avdmanager.bat` invocation. Windows emulator boot runs without an emulator window and waits for Android's completed-boot property. Stopping the device host leaves booted simulators, emulators, and physical devices running.

The hub runs only on loopback, in an owned hidden subprocess. Clients receive bounded image frames over existing authenticated RPC, never the unauthenticated hub URL or its exec routes. Live view is one frame per second, request-completion-driven, pauses in hidden documents, stops on error and releases its timer on unmount. Host capture concurrency is one and frame size is capped at 4 MiB. This is screenshot live view, not H.264/WebRTC video streaming.

On macOS/Linux, actions invoke the pinned agent CLI with explicit device selectors, isolated `AGENT_DEVICE_STATE_DIR` and a 10-second idle timeout. Each action verifies its control session and reopens it if the idle daemon discarded it; potentially sent input is never automatically retried. JSON stdout is kept separate from runner diagnostics, and an agent result must confirm success. Windows Android control uses the SDK's `adb.exe` directly after the same explicit control setup. It supports tap, swipe, Home, opening Settings or a package ID, bounded UI hierarchy snapshots, and printable ASCII text. Unsupported text is rejected before input; user text is quoted for the Android shell. This avoids the pinned agent daemon's incompatible Windows process-identity/truncation paths. Windows hub discovery is restricted to Android.

Actions invalidate cached frames before the panel refreshes. Capture and host mutations are serialized. `stop` explicitly stops only owned control helpers and the viewing hub; call `dispose` during server shutdown. No simulator/SDK/shared daemon is killed. Android screen-clicks use native pixels; iOS manual presses use logical points from the accessibility snapshot to avoid wrong Retina coordinate scaling. SDK/plugin refusal is displayed, never interpreted as success.

### Watching Mac iOS work from Windows

The **Tool machine** selector also supports **This computer** and saved remote
hosts independently of the conversation's project. Local Windows devices use an
existing Android SDK and AVD; iOS simulators require a Mac with full Xcode. The
selected machine owns setup, device discovery, boot, screenshots and controls.
Machine-scoped device requests use paired-host authentication without borrowing
another machine's project/session IDs. If a project ID is supplied, the host
still validates it. A target change clears controls, input and live viewing.

For interactive iOS control, enter the app name or bundle ID and choose **Open
app** before tapping, typing, or taking an accessibility snapshot. The pinned
agent requires an explicit app target; opening without one can leave its XCTest
runner in a blank screen and cause input to time out. The host remembers a
successfully opened target for reconnecting its private idle daemon. **Home**
uses the explicit `com.apple.springboard` target and can initialize control
without opening an arbitrary app. Opening an app is always a user action.

Select the conversation's Mac project/environment, connect to its host, then open **Conversation tools → Devices**. Set up device tools on that host if required, start the device host, select an iOS simulator, and choose **Boot**. **Live view** requests screenshot frames from the Mac through the authenticated host connection. Enable control explicitly to use Home, typing, accessibility snapshots, or manual logical-point input. The app under test must be built and installed in the simulator through its existing project workflow.

The Windows client does not run iOS locally and does not connect to the device hub's private loopback server. The Mac needs full Xcode, an installed iOS simulator runtime, and an available simulator; interactive actions also need the pinned agent tool's XCTest runner to start successfully. Remote host transport support and current installed host/app versions must be verified separately from source tests. This panel provides screenshots and basic input, not the Mac desktop, build logs, or a full video stream. Physical iOS devices are not enumerated by the current simulator discovery contract.

Licenses checked at upstream primary sources: [expo-device-hub LICENSE](https://github.com/expo/expo-device-hub/blob/main/LICENSE), [agent-device LICENSE](https://github.com/callstack/agent-device/blob/v0.21.23/LICENSE). Both use MIT. External installation preserves its package license notices; no external source is vendored here.
