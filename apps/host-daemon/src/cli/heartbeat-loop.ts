type HeartbeatTimer = ReturnType<typeof setTimeout>;

interface SerialHeartbeatLoopOptions {
  clearTimer?: (timer: HeartbeatTimer) => void;
  logError?: (message: string) => void;
  setTimer?: (callback: () => Promise<void>, intervalMs: number) => HeartbeatTimer;
}

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

export function createSerialHeartbeatLoop(
  beat: () => Promise<void>,
  intervalMs: number,
  options: SerialHeartbeatLoopOptions = {}
) {
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? clearTimeout;
  const logError = options.logError ?? console.error;
  let stopped = true;
  let timer: HeartbeatTimer | undefined;

  const schedule = () => {
    timer = setTimer(tick, intervalMs);
  };

  const tick = async () => {
    timer = undefined;
    await runHeartbeatWithRecovery(beat, logError);
    if (!stopped) {
      schedule();
    }
  };

  return {
    start() {
      if (!stopped || timer) {
        return;
      }
      stopped = false;
      schedule();
    },

    stop() {
      stopped = true;
      if (timer) {
        clearTimer(timer);
        timer = undefined;
      }
    }
  };
}
