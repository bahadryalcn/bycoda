/** Keep optional picker code behind its existing lazy loading boundary. */
export function loadModelPicker() {
  return import("../ui/ModelPicker");
}
