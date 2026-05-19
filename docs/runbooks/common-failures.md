# Common Failures

## Conversation Stays Queued

Confirm the host daemon is running and paired. The daemon polls `/api/daemon/jobs/poll`; if it is not running, queued jobs will not move.

## Runtime Is Unavailable

Run the host tool scan by restarting the paired daemon. The agent UI warns when a selected real runtime is missing from the host scan.

## iPhone Gets Completion Notification But No Reply Appears

On the Mac running `abitat iphone`, inspect the Abitat mobile-control diagnostics log:

```sh
tail -f ~/Library/Logs/Abitat/mobile-control.log
```

This log is separate from the Codex desktop app log. It records redacted JSON lines for the local
control server, pairing, relay reconnects, mobile request auth, Codex `thread/read` and `turn/start`
calls, message-list counts, unknown Codex item types, completion polling, and push notification
send/skip/failure decisions. Ask the user to review the file before sharing it with support.

## Push Fails

Check git credentials in the daemon shell. The daemon commits locally first, then runs `git push -u origin <branch>`. Authentication failures mark the conversation failed.

## PR Creation Fails

Run `gh auth status` in the daemon shell. Push success is still recorded; the conversation remains `pushed` with the PR-only error message.

## Daemon Restarts Mid-Run

On reconnect, stale `preparing` or `running` jobs older than five minutes are marked failed so the UI does not stay stuck forever.

## Remote Control Shows Permission Needed

Screen Recording is required for the host daemon to capture the Mac screen. Accessibility is required for the host daemon to send keyboard and click input through System Events.

After changing either permission in macOS System Settings, stop and restart `abitat iphone`, then return to the iPhone dashboard and tap START REMOTE CONTROL again.
