import { useCallback, useEffect, useState } from "react";
import type { OwnerSecret, SecretsClient } from "../model/secretsClient";

export type OwnerSecretsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; secrets: OwnerSecret[]; projectNames: Map<string, string> };

/** Loads saved secrets and project names; `reload` re-reads after a removal or a failure. */
export function useOwnerSecrets(client: SecretsClient | null) {
  const [state, setState] = useState<OwnerSecretsState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!client) return;
    let current = true;
    void (async () => {
      try {
        const [listed, projects] = await Promise.all([
          client.list(),
          // Names are a nicety: a failed project read still shows the secrets by id.
          client.projects().catch(() => []),
        ]);
        if (current)
          setState({
            status: "ready",
            secrets: listed.secrets,
            projectNames: new Map(projects.map((project) => [project.id, project.name])),
          });
      } catch {
        if (current) setState({ status: "error" });
      }
    })();
    return () => {
      current = false;
    };
  }, [client, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { state: client ? state : ({ status: "error" } as OwnerSecretsState), reload };
}
