import type { HostEngine } from "../engine";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { CrewRun } from "../../src/features/crews/model/crew";
import type { CrewDefaultsState } from "./crew-defaults";

export type Principal = {
  projectId: string;
  sessionId: string;
};

export type CrewSessionPorts = {
  session(id: string): Promise<
    Omit<HostSession, "session"> & {
      session: Omit<HostSession["session"], "blocks">;
    }
  >;
  command(
    command: unknown,
    context: {
      authorized(): Promise<boolean>;
      principalId: string;
    },
  ): ReturnType<HostEngine["command"]>;
};

export type CrewState = CrewDefaultsState & {
  runs: CrewRun[];
};
