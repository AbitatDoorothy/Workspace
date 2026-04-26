# Common Failures

## Conversation Stays Queued

Confirm the host daemon is running and paired. The daemon polls `/api/daemon/jobs/poll`; if it is not running, queued jobs will not move.

## Runtime Is Unavailable

Run the host tool scan by restarting the paired daemon. The agent UI warns when a selected real runtime is missing from the host scan.

## Push Fails

Check git credentials in the daemon shell. The daemon commits locally first, then runs `git push -u origin <branch>`. Authentication failures mark the conversation failed.

## PR Creation Fails

Run `gh auth status` in the daemon shell. Push success is still recorded; the conversation remains `pushed` with the PR-only error message.

## Daemon Restarts Mid-Run

On reconnect, stale `preparing` or `running` jobs older than five minutes are marked failed so the UI does not stay stuck forever.
