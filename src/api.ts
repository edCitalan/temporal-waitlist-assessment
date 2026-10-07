import path from "node:path";
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import express, { type NextFunction, type Request, type Response } from "express";
import type {
  ClientReply,
  OpeningInput,
  StaffCancellation,
} from "./types";
import { juniperSalonWorkflow, respondToOffer, salonTaskQueue } from "./workflows";
import { normalizeOpening } from "./opening-input";

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const workflowId = process.env.SALON_WORKFLOW_ID ?? "juniper-salon-waitlist";
let clientPromise: Promise<Client> | undefined;
function getClient(): Promise<Client> {
  clientPromise ??= Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  })
    .then((connection) => new Client({ connection, namespace: "default" }))
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  return clientPromise;
}

async function getSalonHandle() {
  const client = await getClient();
  try {
    await client.workflow.start(juniperSalonWorkflow, {
      workflowId,
      taskQueue: salonTaskQueue,
      args: [],
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
  return client.workflow.getHandle(workflowId);
}

app.get("/api/salon", async (_request, response) => {
  const handle = await getSalonHandle();
  const snapshot = await handle.query("getSalonSnapshot");
  response.json(snapshot);
});

app.post("/api/openings", async (request, response) => {
  let input: OpeningInput;
  try { input = normalizeOpening(request.body); }
  catch (error) {
    response.status(400).json({ error: (error as Error).message });
    return;
  }
  const handle = await getSalonHandle();
  await handle.signal("createOpening", input);
  response.status(202).json({ queued: true });
});

app.post("/api/offers/start", async (_request, response) => {
  const handle = await getSalonHandle();
  await handle.signal("startOffers");
  response.status(202).json({ started: true });
});

app.post("/api/offers/:offerId/reply", async (request, response) => {
  const kind = request.body?.kind;
  if (!["accept", "decline", "question"].includes(kind)) {
    response.status(400).json({ error: "Choose accept, decline, or ask a question." });
    return;
  }
  const reply: ClientReply = {
    offerId: request.params.offerId,
    kind,
    message: typeof request.body?.message === "string" ? request.body.message : undefined,
  };
  const handle = await getSalonHandle();
  const result = await handle.executeUpdate(respondToOffer, { args: [reply] });
  response.json(result);
});

app.post("/api/openings/:openingId/cancel", async (request, response) => {
  const cancellation: StaffCancellation = {
    openingId: request.params.openingId,
    stillOpen: request.body?.stillOpen === true,
    reason: typeof request.body?.reason === "string" ? request.body.reason : "Staff cancelled the offer",
    offerId: typeof request.body?.offerId === "string" ? request.body.offerId : undefined,
  };
  const handle = await getSalonHandle();
  await handle.signal("cancelOpening", cancellation);
  response.status(202).json({ cancelled: true });
});

app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  },
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => console.log(`Juniper Waitlist is available at http://localhost:${port}`));
