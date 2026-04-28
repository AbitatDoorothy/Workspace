export function createRetryableTask(task: () => Promise<void>) {
  let completed = false;

  return {
    get completed() {
      return completed;
    },

    async run() {
      if (completed) {
        return;
      }

      await task();
      completed = true;
    }
  };
}
