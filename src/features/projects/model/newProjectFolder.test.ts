import { describe, expect, it } from "vitest";
import { newProjectParent, projectFolderName } from "./newProjectFolder";

describe("new project folder", () => {
  it("prefers the saved folder", () => {
    expect(newProjectParent("D:/Code/", ["G:/Projects/a", "G:/Projects/b"], "C:/Users/me")).toBe(
      "D:/Code",
    );
  });

  it("otherwise uses the folder most local projects share, ignoring remote ones", () => {
    expect(
      newProjectParent(
        null,
        [
          "G:\\Projects\\my_projects\\bycoda",
          "G:/Projects/my_projects/mobile",
          "G:/Other/one",
          "remote://env/home/a",
          "remote://env/home/b",
        ],
        "C:/Users/me",
      ),
    ).toBe("G:/Projects/my_projects");
  });

  it("falls back to ~/Projects when no folder is shared", () => {
    expect(newProjectParent(null, ["G:/A/one", "G:/B/two"], "C:\\Users\\me\\")).toBe(
      "C:/Users/me/Projects",
    );
    expect(newProjectParent("  ", [], "/home/me")).toBe("/home/me/Projects");
  });

  it("turns a spoken name into a safe folder name", () => {
    expect(projectFolderName("Snake Game!")).toBe("snake-game");
    expect(projectFolderName("  Basit Yılan Oyunu ")).toBe("basit-yılan-oyunu");
    expect(projectFolderName("a/b\\c:d")).toBe("a-b-c-d");
    expect(() => projectFolderName("???")).toThrow();
    expect(() => projectFolderName("CON")).toThrow();
  });
});
