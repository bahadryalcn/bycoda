import { useModelRouting } from "../../model-routing/public/choice";
/** Read-only routing pools; member choices store references, never candidate copies. */
export function useCrewModelPools(machineId: string | undefined, supported: boolean) {
  const routing = useModelRouting(machineId, supported);
  return {
    supported,
    pools: routing.state?.pools ?? [],
    loading: routing.loading,
    error: routing.error,
  };
}
