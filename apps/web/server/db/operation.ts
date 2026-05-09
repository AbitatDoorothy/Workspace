export const DB_OPERATION_TIMEOUT_ERROR_NAME = "DbOperationTimeoutError";

export async function retryDbOperation<T>(
  label: string,
  operation: () => Promise<T>,
  options: { retries: number; timeoutMs: number }
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await runDbOperation(label, operation, options.timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isDbOperationTimeout(error) || attempt >= options.retries) {
        throw error;
      }
      console.warn(`${label} timed out; retrying`, { attempt: attempt + 1 });
    }
  }

  throw lastError;
}

export function runDbOperation<T>(label: string, operation: () => Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new DbOperationTimeoutError(label, timeoutMs));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export function isDbOperationTimeout(error: unknown) {
  return error instanceof Error && error.name === DB_OPERATION_TIMEOUT_ERROR_NAME;
}

class DbOperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = DB_OPERATION_TIMEOUT_ERROR_NAME;
  }
}
