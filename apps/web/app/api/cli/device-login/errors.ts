import { isDbOperationTimeout } from "../../../../server/db/operation";

export function cliDeviceLoginErrorStatus(error: unknown) {
  return isDbOperationTimeout(error) ? 503 : 400;
}
