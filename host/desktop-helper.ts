import {
  prepareDesktopHelper,
  readDesktopHelper,
  readDesktopHelperBundle,
  type DesktopHelperOptions,
  type PreparedDesktopHelper,
} from "../scripts/setup/agent-desktop.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DesktopHelperRequestSchema,
  DesktopHelperResponseSchema,
  type DesktopHelperResponse,
} from "../src/shared/model/host-contracts/desktop-helper";

type Ports = {
  read?: () => Promise<PreparedDesktopHelper | undefined>;
  prepare?: (options: DesktopHelperOptions) => Promise<PreparedDesktopHelper>;
  outsideScope?: <T>(work: () => Promise<T>) => Promise<T>;
};
/** Builds only after explicit owner intent. It never configures or enables input. */
export class HostDesktopHelper {
  private state: DesktopHelperResponse = { phase: "missing" };
  private work?: Promise<void>;
  private controller?: AbortController;
  private closing = false;
  constructor(private ports: Ports = {}) {}
  private prepared(helper: PreparedDesktopHelper): DesktopHelperResponse {
    const { binaryPath, binarySha256, sourceRef, protocol, version, manifestPath } = helper;
    return {
      phase: "ready",
      stage: "ready",
      helper: { binaryPath, binarySha256, sourceRef, protocol, version, manifestPath },
    };
  }
  private async refresh() {
    const prepared = await (
      this.ports.read ??
      (async () =>
        (await readDesktopHelper()) ??
        (await readDesktopHelperBundle(
          join(dirname(fileURLToPath(import.meta.url)), "agent-desktop"),
        )))
    )();
    if (prepared) this.state = this.prepared(prepared);
    else if (this.state.phase === "ready")
      this.state = {
        phase: "missing",
        error: "The prepared helper is missing or its verification changed.",
      };
  }
  async request(raw: unknown, authorized: () => Promise<boolean>): Promise<DesktopHelperResponse> {
    const request = DesktopHelperRequestSchema.parse(raw);
    if (this.closing || !(await authorized()))
      throw new Error("Desktop helper owner authority is unavailable.");
    if (request.op === "cancel") {
      this.controller?.abort();
      await this.work;
    }
    if (!this.work) await this.refresh();
    if (request.op === "prepare" && !this.work && this.state.phase !== "ready") {
      const controller = new AbortController();
      this.controller = controller;
      this.state = { phase: "preparing", stage: "acquiring" };
      const execute = async () => {
        let checking = false;
        const timer = setInterval(() => {
          if (checking) return;
          checking = true;
          void authorized()
            .then(
              (allowed) => {
                if (!allowed) controller.abort();
              },
              () => controller.abort(),
            )
            .finally(() => {
              checking = false;
            });
        }, 1000);
        timer.unref?.();
        try {
          if (!(await authorized())) throw new Error("Desktop helper authority was revoked.");
          const helper = await (this.ports.prepare ?? prepareDesktopHelper)({
            signal: controller.signal,
            onProgress: (event) => {
              this.state = { phase: "preparing", stage: event.stage };
            },
          });
          controller.signal.throwIfAborted();
          if (!(await authorized())) throw new Error("Desktop helper authority was revoked.");
          this.state = this.prepared(helper);
        } catch (error) {
          this.state = {
            phase: controller.signal.aborted ? "interrupted" : "failed",
            error:
              error instanceof Error
                ? error.message.slice(0, 2000)
                : "The helper could not be prepared.",
          };
        } finally {
          clearInterval(timer);
          this.controller = undefined;
          this.work = undefined;
        }
      };
      // A finished HTTP/WS request does not retire this explicitly started job.
      this.work = this.ports.outsideScope ? this.ports.outsideScope(execute) : execute();
    }
    if (!(await authorized())) throw new Error("Desktop helper owner authority was revoked.");
    return DesktopHelperResponseSchema.parse(structuredClone(this.state));
  }
  async close() {
    this.closing = true;
    this.controller?.abort();
    await this.work;
  }
}
