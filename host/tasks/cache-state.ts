import type { HostTask } from "../../src/features/tasks/model/hostTasks";

/** Shapes of the HostTasks read caches. Each cache is valid only for its revision. */
export type TaskEtagCache = {
  revision: number;
  sourceStamp: string;
  etag: string;
};

export type TaskListCache = {
  revision: number;
  byId: Map<string, HostTask>;
  tasks: HostTask[];
};

export type TaskProjectListCache = {
  revision: number;
  tasks: HostTask[];
};

export type TaskAssistantMetadataCache = {
  revision: number;
  sourceStamp: string;
  tasks: HostTask[];
};

export type TaskPointIndex = {
  revision: number;
  entries: Map<
    string,
    {
      value?: HostTask;
      bytes: number;
    }
  >;
  bytes: number;
};
