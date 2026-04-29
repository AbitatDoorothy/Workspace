import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const chooseFolderScript =
  'POSIX path of (choose folder with prompt "Choose a local project folder")';

export interface LocalFolderPickerRunner {
  run(command: string, args: string[]): Promise<{ stdout: string }>;
}

export async function chooseLocalProjectFolder(
  runner: LocalFolderPickerRunner = defaultLocalFolderPickerRunner
) {
  const result = await runner.run("osascript", ["-e", chooseFolderScript]);
  const selectedPath = result.stdout.trim();

  return selectedPath || null;
}

export function isFolderPickerCancel(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("user canceled");
}

const defaultLocalFolderPickerRunner: LocalFolderPickerRunner = {
  async run(command, args) {
    return execFileAsync(command, args);
  }
};
