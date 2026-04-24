export interface StartOptions {
  mock: boolean;
}

export function parseStartOptions(args: string[]): StartOptions {
  return {
    mock: args.includes("--mock")
  };
}
