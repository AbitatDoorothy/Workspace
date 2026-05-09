export const DB_OPERATION_TIMEOUT_ERROR_NAME = "DbOperationTimeoutError";
export const DEFAULT_DB_OPERATION_RETRIES = 2;
export const DEFAULT_DB_OPERATION_TIMEOUT_MS = 30_000;

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
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === DB_OPERATION_TIMEOUT_ERROR_NAME) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("timed out")
  );
}

class DbOperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = DB_OPERATION_TIMEOUT_ERROR_NAME;
  }
}
