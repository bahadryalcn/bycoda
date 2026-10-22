import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "../shared/lib/queryClient";
import { installQueryLifecycle } from "../platform/tauri/queryLifecycle";

/** Each entry point / native window owns one client for its entire mounted lifetime. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createAppQueryClient);
  useEffect(installQueryLifecycle, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
