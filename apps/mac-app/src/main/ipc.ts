import { ipcMain } from "electron";

import type { DesktopApi } from "../shared/types.js";

export function registerDesktopIpc(api: DesktopApi) {
  ipcMain.handle("abitat:getStatus", () => api.getStatus());
  ipcMain.handle("abitat:createPhonePairing", () => api.createPhonePairing());
  ipcMain.handle("abitat:listProjects", () => api.listProjects());
  ipcMain.handle("abitat:listConversations", (_event, projectId: string) =>
    api.listConversations(projectId)
  );
  ipcMain.handle("abitat:listMessages", (_event, conversationId: string, options) =>
    api.listMessages(conversationId, options)
  );
  ipcMain.handle("abitat:startConversation", (_event, projectId: string, input) =>
    api.startConversation(projectId, input)
  );
  ipcMain.handle("abitat:continueConversation", (_event, conversationId: string, input) =>
    api.continueConversation(conversationId, input)
  );
  ipcMain.handle("abitat:listCompletionStates", () => api.listCompletionStates());
  ipcMain.handle("abitat:listModelOptions", () => api.listModelOptions());
  ipcMain.handle("abitat:getTokenUsage", () => api.getTokenUsage());
  ipcMain.handle("abitat:listGeneratedFiles", (_event, conversationId: string) =>
    api.listGeneratedFiles(conversationId)
  );
  ipcMain.handle("abitat:downloadGeneratedFile", (_event, conversationId: string, fileId: string) =>
    api.downloadGeneratedFile(conversationId, fileId)
  );
  ipcMain.handle("abitat:revealPath", (_event, path: string) => api.revealPath(path));
  ipcMain.handle("abitat:openPath", (_event, path: string) => api.openPath(path));
  ipcMain.handle("abitat:getDiagnosticsLog", () => api.getDiagnosticsLog());
  ipcMain.handle("abitat:listAutomations", () => api.listAutomations());
  ipcMain.handle("abitat:createAutomation", (_event, input) => api.createAutomation(input));
  ipcMain.handle("abitat:updateAutomation", (_event, automationId: string, input) =>
    api.updateAutomation(automationId, input)
  );
}
