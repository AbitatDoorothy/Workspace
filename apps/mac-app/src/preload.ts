import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi } from "./shared/types.js";

function invoke<T>(channel: string, ...args: unknown[]) {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api: DesktopApi = {
  continueConversation: (conversationId, input) =>
    invoke("abitat:continueConversation", conversationId, input),
  createAutomation: (input) => invoke("abitat:createAutomation", input),
  createPhonePairing: () => invoke("abitat:createPhonePairing"),
  downloadGeneratedFile: (conversationId, fileId) =>
    invoke("abitat:downloadGeneratedFile", conversationId, fileId),
  getDiagnosticsLog: () => invoke("abitat:getDiagnosticsLog"),
  getStatus: () => invoke("abitat:getStatus"),
  getTokenUsage: () => invoke("abitat:getTokenUsage"),
  listAutomations: () => invoke("abitat:listAutomations"),
  listCompletionStates: () => invoke("abitat:listCompletionStates"),
  listConversations: (projectId) => invoke("abitat:listConversations", projectId),
  listGeneratedFiles: (conversationId) => invoke("abitat:listGeneratedFiles", conversationId),
  listMessages: (conversationId, options) => invoke("abitat:listMessages", conversationId, options),
  listModelOptions: () => invoke("abitat:listModelOptions"),
  listProjects: () => invoke("abitat:listProjects"),
  openPath: (path) => invoke("abitat:openPath", path),
  revealPath: (path) => invoke("abitat:revealPath", path),
  startConversation: (projectId, input) => invoke("abitat:startConversation", projectId, input),
  updateAutomation: (automationId, input) =>
    invoke("abitat:updateAutomation", automationId, input)
};

contextBridge.exposeInMainWorld("abitat", api);
