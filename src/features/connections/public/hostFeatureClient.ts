/** Public connections contract; exports stay explicit to preserve load isolation. */
export {
  featureHost,
  hostFeatureRequest,
  hostToolRequest,
  listHostToolMachines,
} from "../model/hostFeatureClient";
export type { HostToolTarget } from "../model/hostToolTarget";
