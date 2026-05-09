import { conversationMessageCreateRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { conversationMessageService } from "../../../../../../server/conversation-messages";
import { conversationQueueService } from "../../../../../../server/conversations";
import {
  codexAppService,
  isCodexConversationBusyError,
  isCodexConversationId
} from "../../../../../../server/codex-app";
import { hostCodexSnapshotService } from "../../../../../../server/hosts";
import { canUseLocalCodexApp } from "../../../../../../server/mobile/codex-host-access";
import { mobileActivityLog } from "../../../../../../server/mobile/mobile-activity-log";
import { requireMobileActor } from "../../../../../../server/mobile/request-auth";
import { runEventService } from "../../../../../../server/run-events";

const querySchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().optional(),
  includeRuntime: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true")
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  let conversationId = "unknown";
  let actorDetails: Record<string, unknown> = {};
  let requestDetails: Record<string, unknown> = {};

  try {
    const [{ id }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    conversationId = id;
    actorDetails = {
      hostMachineId: actor.hostMachineId,
      machineId: actor.machineId,
      workspaceId: actor.workspaceId
    };
    requestDetails = {
      afterSequence: query.afterSequence ?? null,
      includeRuntime: query.includeRuntime
    };

    if (isCodexConversationId(id)) {
      if (!(await canUseLocalCodexApp(actor))) {
        const conversation = await hostCodexSnapshotService.getConversation({
          conversationId: id,
          hostMachineId: actor.hostMachineId,
          workspaceId: actor.workspaceId
        });

        if (!conversation) {
          mobileActivityLog.record("mobile_codex_messages_access_denied", {
            conversationId,
            reason: "cross_host",
            ...actorDetails,
            ...requestDetails
          });
          return mobileJson({ error: "Conversation not found" }, { status: 404 });
        }

        const messages = await hostCodexSnapshotService.listMessages({
          afterSequence: query.afterSequence,
          conversationId: id,
          hostMachineId: actor.hostMachineId,
          includeRuntime: query.includeRuntime,
          workspaceId: actor.workspaceId
        });
        mobileActivityLog.record("mobile_codex_messages_loaded_from_host_snapshot", {
          conversationId,
          durationMs: Date.now() - startedAt,
          messageCount: messages.length,
          ...messageSequenceStats(messages),
          reason: "cross_host",
          ...actorDetails,
          ...requestDetails
        });
        return mobileJson({ messages });
      }

      const messages = await codexAppService.listMessages(id, {
        afterSequence: query.afterSequence,
        includeRuntime: query.includeRuntime
      });
      mobileActivityLog.record("mobile_messages_loaded", {
        conversationId,
        durationMs: Date.now() - startedAt,
        messageCount: messages.length,
        ...messageSequenceStats(messages),
        source: "codex_app",
        ...actorDetails,
        ...requestDetails
      });

      return mobileJson({ messages });
    }

    await assertMobileConversation(actor.workspaceId, id);
    let messages = await conversationMessageService.listMessages(id, {
      afterSequence: query.afterSequence
    });

    if (!query.afterSequence && messages.length === 0) {
      await backfillMessagesFromRunEvents(id);
      messages = await conversationMessageService.listMessages(id);
    }

    const serializedMessages = messages
      .map(serializeMessage)
      .filter((message) => query.includeRuntime || message.role !== "runtime");
    mobileActivityLog.record("mobile_messages_loaded", {
      conversationId,
      durationMs: Date.now() - startedAt,
      messageCount: serializedMessages.length,
      ...messageSequenceStats(serializedMessages),
      source: "abitat",
      ...actorDetails,
      ...requestDetails
    });

    return mobileJson({ messages: serializedMessages });
  } catch (error) {
    mobileActivityLog.record("mobile_messages_load_failed", {
      conversationId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      ...actorDetails,
      ...requestDetails
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load mobile messages" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}

function mobileJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(init.headers))
    }
  });
}

function messageSequenceStats(messages: Array<{ sequence: number }>) {
  const sequences = messages
    .map((message) => message.sequence)
    .filter((sequence) => Number.isFinite(sequence));

  if (sequences.length === 0) {
    return {
      maxSequence: null,
      minSequence: null
    };
  }

  return {
    maxSequence: Math.max(...sequences),
    minSequence: Math.min(...sequences)
  };
}

async function backfillMessagesFromRunEvents(conversationId: string) {
  const events = await runEventService.listEvents(conversationId);

  for (const event of events) {
    const content = event.content.trim();

    if (!content) {
      continue;
    }

    const role =
      event.type === "approval" && event.metadataJson.role === "user"
        ? "user"
        : event.type === "summary" || event.type === "stdout"
          ? "assistant"
          : event.type === "status" || event.type === "stderr" || event.type === "error"
            ? "runtime"
            : null;

    if (!role) {
      continue;
    }

    await conversationMessageService.appendMessage(conversationId, {
      content,
      role,
      clientMessageId: `run-event-${event.sequence}`,
      metadata: {
        ...event.metadataJson,
        backfilledFromRunEvent: true,
        runEventSequence: event.sequence,
        runEventType: event.type
      }
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, actor, input] = await Promise.all([
      context.params,
      requireMobileActor(request),
      conversationMessageCreateRequestSchema.parseAsync(await request.json())
    ]);

    if (isCodexConversationId(id)) {
      if (!(await canUseLocalCodexApp(actor))) {
        return mobileJson({ error: "Conversation not found" }, { status: 404 });
      }

      const continued = await codexAppService.continueConversation(id, {
        prompt: input.content
      });
      const messages = await codexAppService.listMessages(id);
      const message = messages.at(-1) ?? {
        content: input.content,
        conversationId: continued.conversationId,
        createdAt: new Date().toISOString(),
        id: `${continued.conversationId}_${Date.now()}`,
        metadata: { client: "ios", action: "continue" },
        role: "user" as const,
        sequence: messages.length + 1,
        sourceDeviceId: actor.machineId
      };

      return mobileJson({ message }, { status: 201 });
    }

    await assertMobileConversation(actor.workspaceId, id);
    const message = await conversationMessageService.appendMessage(id, {
      ...input,
      role: input.role ?? "user",
      sourceDeviceId: input.sourceDeviceId ?? actor.machineId
    });

    return mobileJson({ message: serializeMessage(message) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to append mobile message" },
      { status: responseStatus(error) }
    );
  }
}

function responseStatus(error: unknown) {
  if (error instanceof Error && error.message === "Invalid mobile token") {
    return 401;
  }

  if (isCodexConversationBusyError(error)) {
    return 409;
  }

  return 400;
}

async function assertMobileConversation(workspaceId: string, conversationId: string) {
  const conversation = (await conversationQueueService.listConversations(workspaceId)).find(
    (candidate) => candidate.id === conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

function serializeMessage(message: {
  id: string;
  conversationId: string;
  sequence: number;
  role: string;
  sourceDeviceId?: string | null;
  content: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
}) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    role: message.role,
    sourceDeviceId: message.sourceDeviceId ?? null,
    content: message.content,
    metadata: message.metadataJson,
    createdAt: message.createdAt.toISOString()
  };
}
