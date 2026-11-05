const slashed = (path: string) => path.replace(/\\/g, "/");

export const joined = (parent: string, name: string) =>
  `${slashed(parent).replace(/\/+$/, "")}/${slashed(name).replace(/^\/+|\/+$/g, "")}`;

export const alreadyExists = (name: string) =>
  `A file or folder ${name} already exists at this location. Please choose a different name.`;
