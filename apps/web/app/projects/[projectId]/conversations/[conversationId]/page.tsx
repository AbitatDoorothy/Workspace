import { AppShell, Icon } from "../../../../components/app-shell";
import { conversationQueueService } from "../../../../../server/conversations";
import { projectService } from "../../../../../server/projects";
import { reviewService } from "../../../../../server/reviews";
import { runEventService } from "../../../../../server/run-events";
import { ConversationEvents } from "../../../../conversations/conversation-events";

export const dynamic = "force-dynamic";

export default async function ProjectConversationPage({
  params
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
}) {
  const { projectId, conversationId } = await params;
  const [project, conversation, events, changeSet] = await Promise.all([
    getProject(projectId),
    getConversation(projectId, conversationId),
    getEvents(conversationId),
    getChangeSet(conversationId)
  ]);

  if (!project || !conversation) {
    return (
      <AppShell active="queue">
        <section className="workspace-shell">
          <div className="page-header">
            <div className="title-stack">
              <p className="eyebrow">Conversation</p>
              <h1>Not Found</h1>
            </div>
            <a className="button-link" href={`/projects/${projectId}`}>
              Project
            </a>
          </div>
        </section>
      </AppShell>
    );
  }

  const canContinue =
    isTerminalStatus(conversation.status) &&
    Boolean(conversation.branchName && conversation.worktreePath && conversation.runtimeSessionId);
  const diffCounts = countDiffLines(changeSet?.diffText ?? "");
  const primaryFile = changeSet?.filesChangedJson[0] ?? "No changed files";

  return (
    <AppShell active="queue">
      <section className="workspace-shell compact-shell">
        <header className="page-header">
          <div>
            <h1>Task {conversation.id.slice(-6)}</h1>
            <p>
              <span className="status-dot" aria-hidden="true" /> {conversation.status}{" "}
              {conversation.type} for {project.name}
            </p>
          </div>
          <span className={`status-label status-label-${conversation.status}`}>
            {conversation.status}
          </span>
        </header>

        <div className="conversation-detail-grid">
          <section>
            <ConversationEvents
              conversationId={conversation.id}
              initialEvents={events}
              savedPrompt={conversation.prompt}
            />

            {changeSet ? (
              <div className="review-note">
                <span className="avatar-disc">
                  <Icon filled>info</Icon>
                </span>
                <div>
                  <h3>Agent finished.</h3>
                  <p>Awaiting your review on {changeSet.filesChangedJson.length} modified files.</p>
                </div>
              </div>
            ) : null}

            {changeSet ? (
              <label className="commit-message-field">
                Commit message
                <input
                  form="approve-conversation"
                  name="commitMessage"
                  defaultValue={`feat: complete ${conversation.type} task`}
                  required
                />
              </label>
            ) : null}

            {conversation.commitSha || conversation.prUrl || conversation.errorMessage ? (
              <div className="push-result">
                {conversation.commitSha ? (
                  <p>
                    Commit <code>{conversation.commitSha}</code>
                  </p>
                ) : null}
                {conversation.prUrl ? (
                  <a href={conversation.prUrl} rel="noreferrer" target="_blank">
                    Open pull request
                  </a>
                ) : null}
                {conversation.errorMessage ? <p>{conversation.errorMessage}</p> : null}
              </div>
            ) : null}

            {!isTerminalStatus(conversation.status) ? (
              <form
                action={`/api/conversations/${conversation.id}/cancel`}
                className="cancel-form"
                method="post"
              >
                <input type="hidden" name="userId" value="user_demo" />
                <button type="submit">Cancel</button>
              </form>
            ) : null}

            {canContinue ? (
              <form
                className="glass-panel panel project-form"
                action={`/api/conversations/${conversation.id}/continue`}
                id="continue-thread"
                method="post"
              >
                <input type="hidden" name="userId" value="user_demo" />
                <input
                  type="hidden"
                  name="redirectTo"
                  value={`/projects/${project.id}/conversations/${conversation.id}`}
                />
                <label className="wide-field">
                  Continue
                  <textarea name="prompt" defaultValue="Continue this thread." required />
                </label>
                <button type="submit">Continue thread</button>
              </form>
            ) : null}
          </section>

          <section className="conversation-detail-card">
            <div className="diff-header">
              <div className="project-title-row">
                <Icon>description</Icon>
                <h3>{primaryFile}</h3>
              </div>
              <div className="diff-counts">
                <span className="diff-remove">- {diffCounts.removed}</span>
                <span className="diff-add">+ {diffCounts.added}</span>
              </div>
            </div>
            {changeSet ? (
              <div className="diff-code">{renderDiffLines(changeSet.diffText)}</div>
            ) : (
              <div className="diff-code">
                <p>No diff has been collected yet.</p>
              </div>
            )}
          </section>
        </div>

        <div className="floating-review-bar">
          {changeSet ? (
            <form
              action={`/api/conversations/${conversation.id}/approve`}
              id="approve-conversation"
              method="post"
            >
              <input type="hidden" name="approvalType" value="commit_and_push" />
              <input type="hidden" name="approvedByUserId" value="user_demo" />
              <button className="bar-action bar-action-primary" type="submit">
                <Icon filled>rocket_launch</Icon>
                <span>Approve & Push</span>
              </button>
            </form>
          ) : null}
          {!isTerminalStatus(conversation.status) ? (
            <form action={`/api/conversations/${conversation.id}/cancel`} method="post">
              <input type="hidden" name="userId" value="user_demo" />
              <button className="bar-action" type="submit">
                <Icon>close</Icon>
                <span>Cancel</span>
              </button>
            </form>
          ) : null}
          <a
            className="bar-action"
            href={canContinue ? "#continue-thread" : `/projects/${project.id}`}
          >
            <Icon>add_comment</Icon>
            <span>{canContinue ? "Continue" : "Project"}</span>
          </a>
        </div>
      </section>
    </AppShell>
  );
}

function isTerminalStatus(status: string) {
  return ["awaiting_approval", "cancelled", "failed", "pushed"].includes(status);
}

function countDiffLines(diffText: string) {
  return diffText.split("\n").reduce(
    (counts, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        counts.added += 1;
      }

      if (line.startsWith("-") && !line.startsWith("---")) {
        counts.removed += 1;
      }

      return counts;
    },
    { added: 0, removed: 0 }
  );
}

function renderDiffLines(diffText: string) {
  return diffText
    .split("\n")
    .slice(0, 48)
    .map((line, index) => {
      const className = line.startsWith("+")
        ? "diff-line diff-line-add"
        : line.startsWith("-")
          ? "diff-line diff-line-remove"
          : "diff-line";

      return (
        <div className={className} key={`${index}-${line}`}>
          <span className="diff-line-number">{index + 1}</span>
          <span>{line || " "}</span>
        </div>
      );
    });
}

async function getProject(projectId: string) {
  try {
    const projects = await projectService.listProjects("workspace_demo");
    return projects.find((project) => project.id === projectId) ?? null;
  } catch {
    return null;
  }
}

async function getConversation(projectId: string, conversationId: string) {
  try {
    const conversations = await conversationQueueService.listConversations("workspace_demo");
    return (
      conversations.find(
        (conversation) => conversation.id === conversationId && conversation.projectId === projectId
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function getEvents(conversationId: string) {
  try {
    return await runEventService.listEvents(conversationId);
  } catch {
    return [];
  }
}

async function getChangeSet(conversationId: string) {
  try {
    return await reviewService.getChangeSet(conversationId);
  } catch {
    return null;
  }
}
