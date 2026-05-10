# Copy Conversation Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users copy text from sent and received messages in the iPhone conversation interface.

**Architecture:** Add explicit copy affordances to `ConversationScreen` while preserving native text selection. Use Expo Clipboard for deterministic copy behavior and keep the composer paste behavior native through `TextInput`.

**Tech Stack:** React Native, Expo Clipboard, TypeScript, existing `abitat-ios` validation script.

---

### Task 1: Message Copy UI

**Files:**
- Modify: `apps/ios/package.json`
- Modify: `apps/ios/src/screens/ConversationScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [ ] Add `expo-clipboard` to the iOS dependencies.
- [ ] Write a failing validation check requiring `expo-clipboard`, `Clipboard.setStringAsync`, selectable message text, and an accessible Copy button.
- [ ] Add `import * as Clipboard from "expo-clipboard";`.
- [ ] Add `copiedMessageId` state and an async `copyMessageText(message)` function that copies `safeMessageContent(message.content)`.
- [ ] Render a `Copy` button in each message card and set the message text `selectable`.
- [ ] Keep native paste enabled in the composer by explicitly setting `contextMenuHidden={false}`.
- [ ] Run `pnpm --filter abitat-ios test` and `pnpm --filter abitat-ios typecheck`.
- [ ] Run Prettier and `git diff --check`.

