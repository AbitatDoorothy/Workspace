import type { IncomingMessage, ServerResponse } from "node:http";

import {
  remoteControlInputRequestSchema,
  remoteControlSessionCreateRequestSchema
} from "@abitat_reece/shared";

import { logDiagnostics, type MobileControlDiagnosticsLogger } from "../diagnostics-log.js";
import type { LocalPairedDevice } from "../state.js";
import type { LocalRemoteControlManager } from "./types.js";

interface HandleRemoteControlRouteInput {
  actor: LocalPairedDevice;
  diagnostics?: MobileControlDiagnosticsLogger;
  hostMachineId: string;
  manager: LocalRemoteControlManager;
  method: string;
  path: string;
  readJson(request: IncomingMessage): Promise<unknown>;
  request: IncomingMessage;
  response: ServerResponse;
  searchParams: URLSearchParams;
  writeJson(response: ServerResponse, status: number, body: unknown): void;
}

export async function handleLocalRemoteControlRoute(input: HandleRemoteControlRouteInput) {
  if (!input.path.startsWith("/api/remote-control/") && input.path !== "/remote-control/status") {
    return false;
  }

  if (input.method === "GET" && input.path === "/remote-control/status") {
    input.writeJson(input.response, 200, {
      sessions: input.manager.listSessions(input.actor.id)
    });
    return true;
  }

  if (input.method === "GET" && input.path === "/api/remote-control/sessions") {
    input.writeJson(input.response, 200, {
      sessions: input.manager.listSessions(input.actor.id)
    });
    return true;
  }

  if (input.method === "POST" && input.path === "/api/remote-control/sessions") {
    const body = parseRemoteControlInput(
      remoteControlSessionCreateRequestSchema,
      await input.readJson(input.request)
    );
    if (body.hostMachineId !== input.hostMachineId) {
      throw Object.assign(new Error("Phone is not paired to this Mac host"), { statusCode: 403 });
    }

    const session = await input.manager.startSession({
      clientMachineId: input.actor.id,
      hostMachineId: body.hostMachineId,
      inputEnabled: body.inputEnabled,
      screenEnabled: body.screenEnabled
    });
    logDiagnostics(input.diagnostics, "info", "remote_control.session.start", {
      deviceId: input.actor.id,
      hostMachineId: body.hostMachineId,
      inputEnabled: body.inputEnabled,
      screenEnabled: body.screenEnabled,
      sessionId: session.id
    });
    input.writeJson(input.response, 201, { session });
    return true;
  }

  const sessionMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)$/u);
  if (sessionMatch && input.method === "GET") {
    input.writeJson(input.response, 200, {
      session: input.manager.getSession(decodeURIComponent(sessionMatch[1]), input.actor.id)
    });
    return true;
  }

  if (sessionMatch && input.method === "DELETE") {
    const session = await input.manager.endSession(
      decodeURIComponent(sessionMatch[1]),
      input.actor.id
    );
    input.writeJson(input.response, 200, { session });
    return true;
  }

  const frameMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)\/frame$/u);
  if (frameMatch && input.method === "GET") {
    const afterSequence = Number(input.searchParams.get("afterSequence") ?? "-1");
    input.writeJson(
      input.response,
      200,
      input.manager.getLatestFrame(
        decodeURIComponent(frameMatch[1]),
        input.actor.id,
        Number.isFinite(afterSequence) ? afterSequence : -1
      )
    );
    return true;
  }

  const inputMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)\/input$/u);
  if (inputMatch && input.method === "POST") {
    const body = parseRemoteControlInput(
      remoteControlInputRequestSchema,
      await input.readJson(input.request)
    );
    const session = await input.manager.applyInput(
      decodeURIComponent(inputMatch[1]),
      input.actor.id,
      body.event
    );
    input.writeJson(input.response, 200, { ok: true, session });
    return true;
  }

  const textTargetMatch = input.path.match(
    /^\/api\/remote-control\/sessions\/([^/]+)\/text-target$/u
  );
  if (textTargetMatch && input.method === "GET") {
    input.writeJson(input.response, 200, {
      target: await input.manager.getTextInputTarget(
        decodeURIComponent(textTargetMatch[1]),
        input.actor.id
      )
    });
    return true;
  }

  const signalMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)\/signals$/u);
  if (signalMatch && input.method === "GET") {
    input.manager.getSession(decodeURIComponent(signalMatch[1]), input.actor.id);
    input.writeJson(input.response, 200, { signals: [] });
    return true;
  }

  if (signalMatch && input.method === "POST") {
    const body = recordValue(await input.readJson(input.request)) ?? {};
    input.manager.getSession(decodeURIComponent(signalMatch[1]), input.actor.id);
    input.writeJson(input.response, 201, {
      signal: {
        createdAt: new Date().toISOString(),
        id: "signal_compat",
        payload: recordValue(body.payload) ?? {},
        senderMachineId: input.actor.id,
        sessionId: decodeURIComponent(signalMatch[1]),
        type: typeof body.type === "string" ? body.type : "status"
      }
    });
    return true;
  }

  return false;
}

function parseRemoteControlInput<T>(schema: { parse(input: unknown): T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("Invalid remote-control request"), {
      statusCode: 400
    });
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
