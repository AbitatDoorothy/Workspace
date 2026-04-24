import { runEventService } from "../../../../../../server/run-events";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const encoder = new TextEncoder();
  let lastSequence = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvents = async () => {
        const events = await runEventService.listEvents(id);

        for (const event of events) {
          if (event.sequence <= lastSequence) {
            continue;
          }

          lastSequence = event.sequence;
          controller.enqueue(
            encoder.encode(`event: run-event\ndata: ${JSON.stringify(event)}\n\n`)
          );
        }
      };

      await sendEvents();
      const interval = setInterval(() => {
        void sendEvents().catch((error: unknown) => {
          controller.error(error);
          clearInterval(interval);
        });
      }, 1000);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream"
    }
  });
}
