import { QueryClient, type QueryKey } from "@tanstack/react-query";

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        // Existing host reads report errors and retry on the next poll.
        retry: false,
        // Host IPC remains usable without an Internet connection.
        networkMode: "always",
      },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

/** Adapt an existing host/cache subscription without introducing another bus. */
export function bridgeQueryEvents<T>(
  client: QueryClient,
  subscribe: (receive: (event: T) => void) => () => void,
  update: (event: T) => { queryKey: QueryKey; data?: unknown },
) {
  return subscribe((event) => {
    const change = update(event);
    if ("data" in change) client.setQueryData(change.queryKey, change.data);
    else void client.invalidateQueries({ queryKey: change.queryKey });
  });
}
