export type FolderPickerOptions = { title: string; multiple: boolean };
type Picker = (options: FolderPickerOptions) => Promise<string[]>;
let picker: Picker | undefined;

/** App composition owns UI loading; native/Host file adapters never import it. */
export function configureFolderPicker(next: Picker): () => void {
  picker = next;
  return () => {
    if (picker === next) picker = undefined;
  };
}
export function requestFolderPicker(options: FolderPickerOptions): Promise<string[]> {
  if (!picker)
    return Promise.reject(new Error("The application folder picker is not initialized."));
  return picker(options);
}
