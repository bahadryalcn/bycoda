/** Public sessions contract; exports stay explicit to preserve load isolation. */
export { rendererPersistenceDrain } from "../data/persistenceDrain";
export type {
  PersistenceDrainRegistry,
  PersistenceProducer,
  PersistenceWork,
} from "../data/persistenceDrain";
