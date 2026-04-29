import { describe, expect, it } from "vitest";

import {
  chooseLocalProjectFolder,
  isFolderPickerCancel
} from "../server/projects/local-folder-picker";

describe("local folder picker", () => {
  it("uses the macOS folder chooser and returns the selected POSIX path", async () => {
    const calls: Array<{ args: string[]; command: string }> = [];

    const path = await chooseLocalProjectFolder({
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: "/Users/reece/Desktop/Test/\n" };
      }
    });

    expect(path).toBe("/Users/reece/Desktop/Test/");
    expect(calls).toEqual([
      {
        command: "osascript",
        args: ["-e", 'POSIX path of (choose folder with prompt "Choose a local project folder")']
      }
    ]);
  });

  it("treats an empty folder chooser response as no selection", async () => {
    await expect(
      chooseLocalProjectFolder({
        run: async () => ({ stdout: "\n" })
      })
    ).resolves.toBeNull();
  });

  it("recognizes user cancellation from osascript", () => {
    expect(isFolderPickerCancel(new Error("User canceled."))).toBe(true);
  });
});
