import { parseHostSteward as parseLegacy } from "../../src/features/tasks/model/hostStewards";
import { routingInput } from "../tasks/model-routing";
import { HostStewardInputSchema } from "../../src/shared/model/host-contracts/stewards";
export function parseHostSteward(raw: unknown) {
  return {
    ...routingInput(parseLegacy, raw),
    providerAccountId: HostStewardInputSchema.shape.providerAccountId.parse(
      (raw as { providerAccountId?: unknown }).providerAccountId,
    ),
  };
}
