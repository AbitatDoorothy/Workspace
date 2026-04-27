export async function runHeartbeatWithRecovery(
  beat: () => Promise<void>,
  logError: (message: string) => void = console.error
) {
  try {
    await beat();
  } catch (error) {
    const message = error instanceof Error ? error.message : "heartbeat failed";
    logError(`heartbeat failed; retrying: ${message}`);
  }
}
