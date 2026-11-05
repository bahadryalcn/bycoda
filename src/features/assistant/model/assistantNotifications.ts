import type {
  AssistantNotification,
  AssistantRequest,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";

type Ports = {
  request(input: AssistantRequest): Promise<unknown>;
  deliver(
    notification: AssistantNotification,
    projectPath?: string,
    projectPaths?: string[],
  ): Promise<boolean>;
  projectPath(id: string): Promise<string | undefined>;
  lead(): Promise<boolean>;
  current(id: string): Promise<AssistantNotification | undefined>;
  storage?: Pick<Storage, "getItem" | "setItem">;
};
const KEY = "bycoda.assistant.notification-ack-pending.v1";

/** Persist successful native outcomes before retrying a failed Host acknowledgement. */
export class AssistantNotificationDelivery {
  private delivered = new Set<string>();
  private running = false;
  constructor(private ports: Ports) {
    try {
      const stored: unknown = JSON.parse(ports.storage?.getItem(KEY) ?? "[]");
      if (Array.isArray(stored))
        this.delivered = new Set(
          stored
            .filter((id): id is string => typeof id === "string" && id.length <= 200)
            .slice(-1000),
        );
    } catch {
      /* Retain in-memory deduplication when storage is unavailable. */
    }
  }
  private save() {
    try {
      this.ports.storage?.setItem(KEY, JSON.stringify([...this.delivered].slice(-1000)));
    } catch {
      /* Never repeat a known delivered notification in this process. */
    }
  }
  private async acknowledge(id: string) {
    try {
      await this.ports.request({ op: "notifications.ack", id });
      this.delivered.delete(id);
      this.save();
    } catch {
      /* Next poll retries only the acknowledgement. */
    }
  }
  async check(snapshot: AssistantSnapshot) {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.ports.lead())) return;
      const handled = new Set(this.delivered);
      for (const id of Array.from(this.delivered)) await this.acknowledge(id);
      if (!snapshot.profile.enabled || !snapshot.profile.setupComplete) return;
      for (const candidate of (snapshot.notifications ?? []).slice(0, 5)) {
        if (!candidate.eligible || handled.has(candidate.id)) continue;
        const notification = await this.ports.current(candidate.id);
        if (!notification?.eligible) continue;
        const projectIds =
          notification.projectIds ??
          (notification.projectId ? [notification.projectId] : undefined);
        if (!projectIds && notification.kind !== "budget.exhausted") continue;
        const paths = await Promise.all((projectIds ?? []).map((id) => this.ports.projectPath(id)));
        if (paths.some((path) => !path)) continue;
        const verifiedPaths = paths as string[];
        // Lead ownership can change while resolving an authoritative project.
        if (!(await this.ports.lead())) return;
        if (!(await this.ports.deliver(notification, verifiedPaths[0], verifiedPaths))) continue;
        this.delivered.add(notification.id);
        this.save();
        await this.acknowledge(notification.id);
      }
    } finally {
      this.running = false;
    }
  }
}
