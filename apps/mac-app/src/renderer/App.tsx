import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Folder,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  TerminalSquare
} from "lucide-react";

import type {
  CodexAutomationSummary,
  CodexAutomationWriteInput,
  LocalCodexCompletionState,
  LocalCodexConversationSummary,
  LocalCodexMessage,
  LocalCodexProjectSummary,
  LocalGeneratedFileSummary
} from "@abitat_reece/host-daemon/local-control";
import type { CodexMobileModelSettings, CodexModelOption } from "@abitat_reece/shared";

import type {
  DesktopDiagnosticsLog,
  DesktopPairingPayload,
  DesktopRuntimeStatus,
  DesktopTokenUsageSummary
} from "../shared/types";
import {
  activeCompletionCount,
  formatBytes,
  formatTokenCount,
  sortConversations,
  sortProjects,
  statusTone
} from "./view-model";

const DEFAULT_MODEL_SETTINGS: CodexMobileModelSettings = {
  effort: "medium",
  model: "gpt-5"
};

const EMPTY_AUTOMATION: AutomationDraft = {
  cwdsText: "",
  executionEnvironment: "local",
  id: null,
  kind: "cron",
  model: "gpt-5",
  name: "",
  prompt: "",
  reasoningEffort: "medium",
  rrule: "FREQ=HOURLY;INTERVAL=8",
  status: "ACTIVE"
};

type DeliveryMode = "queue" | "steer";

interface AutomationDraft {
  cwdsText: string;
  executionEnvironment: string;
  id: string | null;
  kind: string;
  model: string;
  name: string;
  prompt: string;
  reasoningEffort: string;
  rrule: string;
  status: "ACTIVE" | "PAUSED";
}

export function App() {
  const [status, setStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [projects, setProjects] = useState<LocalCodexProjectSummary[]>([]);
  const [conversationsByProject, setConversationsByProject] = useState<
    Record<string, LocalCodexConversationSummary[]>
  >({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalCodexMessage[]>([]);
  const [completionStates, setCompletionStates] = useState<LocalCodexCompletionState[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<LocalGeneratedFileSummary[]>([]);
  const [tokenUsage, setTokenUsage] = useState<DesktopTokenUsageSummary | null>(null);
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const [modelSettings, setModelSettings] =
    useState<CodexMobileModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("queue");
  const [prompt, setPrompt] = useState("");
  const [pairing, setPairing] = useState<DesktopPairingPayload | null>(null);
  const [diagnosticsLog, setDiagnosticsLog] = useState<DesktopDiagnosticsLog | null>(null);
  const [automations, setAutomations] = useState<CodexAutomationSummary[]>([]);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft>(EMPTY_AUTOMATION);
  const [isSending, setIsSending] = useState(false);
  const [isSavingAutomation, setIsSavingAutomation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, sortedProjects]
  );
  const projectConversations = useMemo(
    () => sortConversations(conversationsByProject[selectedProjectId ?? ""] ?? []),
    [conversationsByProject, selectedProjectId]
  );
  const selectedConversation = useMemo(
    () =>
      projectConversations.find((conversation) => conversation.id === selectedConversationId) ??
      null,
    [projectConversations, selectedConversationId]
  );
  const selectedCompletion = completionStates.find(
    (state) => state.conversationId === selectedConversationId
  );
  const activeCount = activeCompletionCount(completionStates);
  const canSend = prompt.trim().length > 0 && Boolean(selectedProject) && !isSending;

  useEffect(() => {
    void refreshAll();
    const timer = setInterval(() => void refreshAll({ quiet: true }), 3500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedProjectId && sortedProjects[0]) {
      setSelectedProjectId(sortedProjects[0].id);
    }
  }, [selectedProjectId, sortedProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    void refreshProjectConversations(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setGeneratedFiles([]);
      return;
    }
    void refreshConversation(selectedConversationId);
  }, [selectedConversationId]);

  async function refreshAll(options: { quiet?: boolean } = {}) {
    try {
      const [nextStatus, nextProjects, nextCompletions, nextTokenUsage, nextModels, nextAutomations] =
        await Promise.all([
          window.abitat.getStatus(),
          window.abitat.listProjects(),
          window.abitat.listCompletionStates(),
          window.abitat.getTokenUsage(),
          window.abitat.listModelOptions(),
          window.abitat.listAutomations()
        ]);
      setStatus(nextStatus);
      setProjects(nextProjects);
      setCompletionStates(nextCompletions);
      setTokenUsage(nextTokenUsage);
      setModels(nextModels);
      setAutomations(nextAutomations);
      if (!automationDraft.id && nextAutomations[0]) {
        setAutomationDraft(draftFromAutomation(nextAutomations[0]));
      }
      if (!options.quiet) {
        setError(null);
      }
    } catch (caught) {
      if (!options.quiet) {
        setError(errorMessage(caught));
      }
    }
  }

  async function refreshProjectConversations(projectId: string) {
    try {
      const conversations = await window.abitat.listConversations(projectId);
      setConversationsByProject((current) => ({ ...current, [projectId]: conversations }));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function refreshConversation(conversationId: string) {
    try {
      const [nextMessages, nextFiles] = await Promise.all([
        window.abitat.listMessages(conversationId, { forceRefresh: true, includeRuntime: false }),
        window.abitat.listGeneratedFiles(conversationId)
      ]);
      setMessages(nextMessages);
      setGeneratedFiles(nextFiles);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function sendPrompt() {
    if (!canSend || !selectedProject) {
      return;
    }

    const submittedPrompt = prompt.trim();
    setPrompt("");
    setIsSending(true);
    try {
      const result = selectedConversation
        ? await window.abitat.continueConversation(selectedConversation.id, {
            clientMessageId: `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            delivery: deliveryMode,
            modelSettings,
            prompt: submittedPrompt
          })
        : await window.abitat.startConversation(selectedProject.id, {
            modelSettings,
            prompt: submittedPrompt
          });
      setSelectedConversationId(result.conversationId);
      await refreshProjectConversations(selectedProject.id);
      await refreshConversation(result.conversationId);
      await refreshAll({ quiet: true });
    } catch (caught) {
      setPrompt(submittedPrompt);
      setError(errorMessage(caught));
    } finally {
      setIsSending(false);
    }
  }

  async function createPairing() {
    try {
      setPairing(await window.abitat.createPhonePairing());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function loadDiagnosticsLog() {
    try {
      setDiagnosticsLog(await window.abitat.getDiagnosticsLog());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function saveAutomation() {
    const input = automationInputFromDraft(automationDraft);
    if (!input.name || !input.prompt || !input.rrule) {
      setError("Automation name, prompt, and schedule are required.");
      return;
    }

    setIsSavingAutomation(true);
    try {
      const saved = automationDraft.id
        ? await window.abitat.updateAutomation(automationDraft.id, input)
        : await window.abitat.createAutomation(input);
      const nextAutomations = await window.abitat.listAutomations();
      setAutomations(nextAutomations);
      setAutomationDraft(draftFromAutomation(saved));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingAutomation(false);
    }
  }

  function selectProject(project: LocalCodexProjectSummary) {
    setSelectedProjectId(project.id);
    setSelectedConversationId(null);
    setMessages([]);
    setGeneratedFiles([]);
  }

  function selectConversation(conversation: LocalCodexConversationSummary) {
    setSelectedConversationId(conversation.id);
  }

  return (
    <main className="app-shell">
      <aside className="project-rail">
        <header className="brand-row">
          <div>
            <p className="eyebrow">LOCAL MAC</p>
            <h1>ABITAT</h1>
          </div>
          <button className="icon-button" onClick={() => void refreshAll()} type="button">
            <RefreshCw size={17} />
          </button>
        </header>

        <section className="status-strip">
          <span className={`status-dot ${status?.codex.available ? "ok" : "warn"}`} />
          <span>{status?.macName ?? "Starting Mac app"}</span>
        </section>

        <section className="project-list">
          <div className="section-row">
            <h2>PROJECTS</h2>
            <span>{sortedProjects.length}</span>
          </div>
          {sortedProjects.map((project) => {
            const active = project.id === selectedProjectId;
            const conversations = sortConversations(conversationsByProject[project.id] ?? []);
            return (
              <div className="project-group" key={project.id}>
                <button
                  className={`project-button ${active ? "selected" : ""}`}
                  onClick={() => selectProject(project)}
                  type="button"
                >
                  <Folder size={17} />
                  <span>{project.name}</span>
                  <small>{project.conversationCount ?? conversations.length}</small>
                </button>
                {active ? (
                  <div className="thread-list">
                    <button
                      className={`thread-button ${!selectedConversationId ? "selected" : ""}`}
                      onClick={() => setSelectedConversationId(null)}
                      type="button"
                    >
                      <Plus size={14} />
                      <span>NEW THREAD</span>
                    </button>
                    {conversations.map((conversation) => (
                      <button
                        className={`thread-button ${
                          conversation.id === selectedConversationId ? "selected" : ""
                        }`}
                        key={conversation.id}
                        onClick={() => selectConversation(conversation)}
                        type="button"
                      >
                        <span className={`mini-dot ${statusTone(String(conversation.status))}`} />
                        <span>{conversation.prompt || "Codex thread"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </aside>

      <section className="chat-pane">
        <header className="chat-header">
          <div>
            <p className="eyebrow">{selectedProject?.name ?? "NO PROJECT"}</p>
            <h2>{selectedConversation?.prompt || "New Thread"}</h2>
          </div>
          <div className="header-actions">
            <StatusBadge
              status={String(selectedCompletion?.status ?? selectedConversation?.status ?? "draft")}
            />
            <button
              className="ghost-button"
              disabled={!selectedConversationId}
              onClick={() => void refreshConversation(selectedConversationId ?? "")}
              type="button"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <div className="message-list">
          {messages.length > 0 ? (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-meta">
                  <span>{message.role.toUpperCase()}</span>
                  <span>#{message.sequence}</span>
                </div>
                <p>{message.content}</p>
              </article>
            ))
          ) : (
            <div className="empty-panel">
              <MessageSquare size={24} />
              <span>{selectedProject ? "Start or select a thread" : "No Codex projects loaded"}</span>
            </div>
          )}
        </div>

        <footer className="composer">
          <div className="composer-tools">
            <select
              aria-label="Codex model"
              onChange={(event) =>
                setModelSettings((current) => ({ ...current, model: event.target.value }))
              }
              value={modelSettings.model}
            >
              {modelChoices(models, modelSettings.model).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Codex effort"
              onChange={(event) =>
                setModelSettings((current) => ({
                  ...current,
                  effort: event.target.value as CodexMobileModelSettings["effort"]
                }))
              }
              value={modelSettings.effort}
            >
              {effortChoices(models, modelSettings.model, modelSettings.effort).map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
            <div className="segmented-control" role="group">
              {(["queue", "steer"] as const).map((mode) => (
                <button
                  className={deliveryMode === mode ? "selected" : ""}
                  key={mode}
                  onClick={() => setDeliveryMode(mode)}
                  type="button"
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="composer-row">
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void sendPrompt();
                }
              }}
              placeholder="Send a prompt to local Codex"
              value={prompt}
            />
            <button
              className="send-button"
              disabled={!canSend}
              onClick={() => void sendPrompt()}
              type="button"
            >
              {isSending ? <Activity size={18} /> : <Send size={18} />}
            </button>
          </div>
        </footer>
      </section>

      <aside className="ops-rail">
        {error ? <div className="error-banner">{error}</div> : null}

        <section className="ops-card">
          <div className="section-row">
            <h2>RUNNING</h2>
            <span>{activeCount}</span>
          </div>
          <div className="completion-list">
            {completionStates.slice(0, 5).map((state) => (
              <button
                className="completion-row"
                key={state.conversationId}
                onClick={() => {
                  setSelectedProjectId(state.projectId);
                  setSelectedConversationId(state.conversationId);
                }}
                type="button"
              >
                <span className={`mini-dot ${statusTone(String(state.status))}`} />
                <span>{state.prompt || state.conversationId}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ops-card">
          <div className="section-row">
            <h2>PHONE</h2>
            <Smartphone size={15} />
          </div>
          <button className="wide-button" onClick={() => void createPairing()} type="button">
            <Copy size={16} />
            PAIR
          </button>
          {pairing ? (
            <div className="pairing-panel">
              <img alt="Abitat pairing QR code" src={pairing.qrDataUrl} />
              <strong>{pairing.manualCode}</strong>
              <small>{pairing.relayId ?? "local"}</small>
            </div>
          ) : null}
        </section>

        <section className="ops-card">
          <div className="section-row">
            <h2>TOKENS</h2>
            <Bot size={15} />
          </div>
          <div className="token-grid">
            <Metric
              label="1D"
              value={formatTokenCount(tokenUsage?.timeframes["1d"].totalTokens ?? 0)}
            />
            <Metric
              label="7D"
              value={formatTokenCount(tokenUsage?.timeframes["7d"].totalTokens ?? 0)}
            />
            <Metric
              label="ALL"
              value={formatTokenCount(tokenUsage?.timeframes.all.totalTokens ?? 0)}
            />
          </div>
        </section>

        <section className="ops-card">
          <div className="section-row">
            <h2>FILES</h2>
            <FileText size={15} />
          </div>
          {generatedFiles.length > 0 ? (
            generatedFiles.map((file) => (
              <button
                className="file-row"
                key={file.id}
                onClick={() => void window.abitat.revealPath(file.path)}
                type="button"
              >
                <span>{file.name}</span>
                <small>{formatBytes(file.size)}</small>
              </button>
            ))
          ) : (
            <p className="muted-line">No generated files</p>
          )}
        </section>

        <section className="ops-card">
          <div className="section-row">
            <h2>AUTOMATIONS</h2>
            <Clock3 size={15} />
          </div>
          <div className="automation-list">
            {automations.map((automation) => (
              <button
                className={`automation-row ${
                  automation.id === automationDraft.id ? "selected" : ""
                }`}
                key={automation.id}
                onClick={() => setAutomationDraft(draftFromAutomation(automation))}
                type="button"
              >
                {automation.status === "ACTIVE" ? <Play size={13} /> : <Pause size={13} />}
                <span>{automation.name}</span>
              </button>
            ))}
          </div>
          <AutomationEditor
            draft={automationDraft}
            isSaving={isSavingAutomation}
            onChange={setAutomationDraft}
            onNew={() => setAutomationDraft(EMPTY_AUTOMATION)}
            onSave={() => void saveAutomation()}
          />
        </section>

        <section className="ops-card">
          <div className="section-row">
            <h2>LOGS</h2>
            <TerminalSquare size={15} />
          </div>
          <button className="wide-button" onClick={() => void loadDiagnosticsLog()} type="button">
            <RefreshCw size={16} />
            LOAD
          </button>
          {diagnosticsLog ? (
            <pre className="log-preview">{diagnosticsLog.data || "empty log"}</pre>
          ) : null}
        </section>

        <section className="ops-card">
          <div className="section-row">
            <h2>REMOTE</h2>
            <Monitor size={15} />
          </div>
          <div className="remote-ready">
            <Bell size={15} />
            <span>PHONE READY</span>
            <ChevronRight size={14} />
          </div>
        </section>
      </aside>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${statusTone(status)}`}>{status.toUpperCase()}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AutomationEditor({
  draft,
  isSaving,
  onChange,
  onNew,
  onSave
}: {
  draft: AutomationDraft;
  isSaving: boolean;
  onChange(draft: AutomationDraft): void;
  onNew(): void;
  onSave(): void;
}) {
  return (
    <div className="automation-editor">
      <div className="editor-row">
        <button className="small-button" onClick={onNew} type="button">
          <Plus size={13} />
          New
        </button>
        <button className="small-button primary" disabled={isSaving} onClick={onSave} type="button">
          <Check size={13} />
          Save
        </button>
      </div>
      <input
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
        placeholder="Name"
        value={draft.name}
      />
      <input
        onChange={(event) => onChange({ ...draft, rrule: event.target.value })}
        placeholder="RRULE"
        value={draft.rrule}
      />
      <div className="editor-row">
        <input
          onChange={(event) => onChange({ ...draft, model: event.target.value })}
          placeholder="Model"
          value={draft.model}
        />
        <input
          onChange={(event) => onChange({ ...draft, reasoningEffort: event.target.value })}
          placeholder="Effort"
          value={draft.reasoningEffort}
        />
      </div>
      <div className="editor-row">
        <input
          onChange={(event) => onChange({ ...draft, kind: event.target.value })}
          placeholder="Kind"
          value={draft.kind}
        />
        <input
          onChange={(event) => onChange({ ...draft, executionEnvironment: event.target.value })}
          placeholder="Env"
          value={draft.executionEnvironment}
        />
      </div>
      <textarea
        onChange={(event) => onChange({ ...draft, cwdsText: event.target.value })}
        placeholder="Workspaces"
        value={draft.cwdsText}
      />
      <textarea
        onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
        placeholder="Prompt"
        value={draft.prompt}
      />
      <div className="editor-row">
        <select
          onChange={(event) =>
            onChange({ ...draft, status: event.target.value as AutomationDraft["status"] })
          }
          value={draft.status}
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="PAUSED">PAUSED</option>
        </select>
      </div>
    </div>
  );
}

function modelChoices(models: CodexModelOption[], activeModel: string) {
  if (models.length > 0) {
    return models;
  }
  return [
    {
      defaultReasoningEffort: "medium",
      description: "",
      displayName: activeModel,
      id: activeModel,
      isDefault: true,
      supportedReasoningEfforts: ["medium"]
    } satisfies CodexModelOption
  ];
}

function effortChoices(
  models: CodexModelOption[],
  activeModel: string,
  activeEffort: CodexMobileModelSettings["effort"]
) {
  return (
    models.find((model) => model.id === activeModel)?.supportedReasoningEfforts ?? [activeEffort]
  );
}

function draftFromAutomation(automation: CodexAutomationSummary): AutomationDraft {
  return {
    cwdsText: automation.cwds.join("\n"),
    executionEnvironment: automation.executionEnvironment,
    id: automation.id,
    kind: automation.kind,
    model: automation.model,
    name: automation.name,
    prompt: automation.prompt,
    reasoningEffort: automation.reasoningEffort,
    rrule: automation.rrule,
    status: automation.status
  };
}

function automationInputFromDraft(draft: AutomationDraft): CodexAutomationWriteInput {
  return {
    cwds: draft.cwdsText
      .split(/\r?\n/u)
      .map((cwd) => cwd.trim())
      .filter(Boolean),
    executionEnvironment: draft.executionEnvironment.trim() || "local",
    kind: draft.kind.trim() || "cron",
    model: draft.model.trim() || "gpt-5",
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    reasoningEffort: draft.reasoningEffort.trim() || "medium",
    rrule: draft.rrule.trim(),
    status: draft.status
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
