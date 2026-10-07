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
  SalonSnapshot,
} from "./types";
import { juniperSalonWorkflow, respondToOffer, salonTaskQueue } from "./workflows";
import { normalizeOpening } from "./opening-input";
import { createStaffAuth, loadStaffCredentials } from "./auth";
import { createOfferLinks, loadOfferLinkSecret, projectClientOffer } from "./client-offer";

const app = express();
app.use(express.json({ limit: "16kb" }));
const auth = createStaffAuth(loadStaffCredentials());
const offerLinks = createOfferLinks(loadOfferLinkSecret());
app.use("/api", auth.sameOrigin);
app.post("/api/auth/login", auth.login);
app.post("/api/auth/logout", auth.logout);
app.get("/login", (request, response) => {
  response.set("Cache-Control", "no-store");
  if (auth.currentStaff(request)) { response.redirect("/"); return; }
  response.sendFile(path.join(process.cwd(), "public/login.html"));
});
app.get("/styles.css", (_request, response) => response.sendFile(path.join(process.cwd(), "public/styles.css")));
app.get("/login.js", (_request, response) => response.sendFile(path.join(process.cwd(), "public/login.js")));
app.get("/offer", (_request, response) => {
  response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  response.sendFile(path.join(process.cwd(), "public/client-offer.html"));
});
app.get("/client-offer.js", (_request, response) => response.sendFile(path.join(process.cwd(), "public/client-offer.js")));
app.use("/api/client/offer", async (request, response, next) => {
  response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const token = request.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const claims = offerLinks.verify(token);
  if (!claims || claims.workflowId !== workflowId) {
    response.status(401).json({ error: "This offer link is invalid. Please ask the salon for your offer link." });
    return;
  }
  const client = await getClient();
  response.locals.clientHandle = client.workflow.getHandle(claims.workflowId, claims.runId);
  response.locals.clientOfferId = claims.offerId;
  next();
});
app.get("/api/client/offer", async (_request, response) => {
  const snapshot: SalonSnapshot = await response.locals.clientHandle.query("getSalonSnapshot");
  const offer = projectClientOffer(snapshot, response.locals.clientOfferId);
  if (!offer) { response.status(404).json({ error: "This offer is no longer available. Please contact the salon." }); return; }
  response.json(offer);
});
app.post("/api/client/offer/reply", async (request, response) => {
  const kind = request.body?.kind;
  if (!["accept", "decline", "question"].includes(kind)) {
    response.status(400).json({ error: "Choose accept, decline, or ask a question." }); return;
  }
  const result = await response.locals.clientHandle.executeUpdate(respondToOffer, { args: [{
    offerId: response.locals.clientOfferId, kind,
    message: typeof request.body.message === "string" ? request.body.message.slice(0, 500) : undefined,
  }] });
  response.json({ code: result.code });
});
app.use(auth.requireStaff);
app.get("/api/auth/session", (_request, response) => response.json({ staff: response.locals.staff }));
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
  const snapshot = await handle.query<SalonSnapshot>("getSalonSnapshot");
  const { runId } = await handle.describe();
  response.json({ ...snapshot, offers: snapshot.offers.map(offer => ({ ...offer,
    clientUrl: `/offer#${offerLinks.issue({ workflowId, runId, offerId: offer.id })}`,
  })) });
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
