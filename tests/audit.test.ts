import assert from "node:assert/strict";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { advanceSimulation, getSalonSnapshot, juniperSalonWorkflow, recordSquareUpdate, respondToOffer, submitOpening } from "../src/workflows";
import { normalizeOpening } from "../src/opening-input";
import { projectClientOffer } from "../src/client-offer";
import type { OpeningInput } from "../src/types";

type Handle = WorkflowHandle<typeof juniperSalonWorkflow>;
const input = (requestId: string, overrides: Partial<OpeningInput> = {}): OpeningInput => {
  const date = new Date(Date.now() + 7 * 86400000);
  date.setUTCDate(date.getUTCDate() + (4 - date.getUTCDay() + 7) % 7);
  date.setUTCHours(22, 0, 0, 0);
  return normalizeOpening({ requestId, service: "Haircut", stylist: "Jules", startsAt: date.toISOString(), durationMinutes: 60, timeZone: "America/Los_Angeles", ...overrides });
};
async function run(name: string, scenario: (handle: Handle, env: TestWorkflowEnvironment) => Promise<void>) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: name, workflowsPath: require.resolve("../src/workflows") });
    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(juniperSalonWorkflow, { workflowId: name, taskQueue: name });
      try { await scenario(handle, env); }
      finally { await handle.cancel(); }
    });
  } finally { await env.teardown(); }
}
const add = (h: Handle, opening: OpeningInput) => h.executeUpdate(submitOpening, { args: [opening] });
const advance = (h: Handle, minutes: number) => h.executeUpdate(advanceSimulation, { args: [minutes] });
const reply = (h: Handle, offerId: string, kind: "accept" | "decline" | "question") => h.executeUpdate(respondToOffer, { args: [{ offerId, kind, message: kind === "question" ? "Can I ask about the service?" : undefined }] });

test("retried creation returns the same opening and rejects changed reuse of its ID", async () => {
  await run("audit-retry", async h => {
    const opening = input("retry-1");
    const results = await Promise.all([add(h, opening), add(h, opening)]);
    assert.deepEqual(results.map(r => r.code).sort(), ["created", "duplicate"]);
    assert.equal(results[0].openingId, results[1].openingId);
    assert.equal((await add(h, { ...opening, service: "Color" })).code, "conflict");
    assert.equal((await h.query(getSalonSnapshot)).openings.length, 1);
  });
});

test("two staff submissions for the same stylist and time cannot create two reservations", async () => {
  await run("audit-duplicate-slot", async h => {
    const first = input("staff-lena");
    const outcomes = await Promise.all([add(h, first), add(h, { ...first, requestId: "staff-carla" })]);
    assert.deepEqual(outcomes.map(r => r.code).sort(), ["conflict", "created"]);
    await h.signal("startOffers");
    let state = await h.query(getSalonSnapshot);
    assert.equal(state.openings.length, 1);
    await reply(h, state.offers[0].id, "accept");
    assert.equal((await add(h, { ...first, requestId: "after-booking" })).code, "conflict");
    state = await h.query(getSalonSnapshot);
    assert.equal(state.offers.filter(o => o.status === "accepted").length, 1);
    assert.equal((await add(h, { ...first, requestId: "different-stylist", stylist: "Rosa" })).code, "created");
  });
});

test("15-minute fast-forward processes every shorter deadline with a complete message trail", async () => {
  await run("audit-clock", async (h, env) => {
    await add(h, input("clock", { responseMinutes: 5 }));
    await h.signal("startOffers");
    const first = (await h.query(getSalonSnapshot)).offers[0];
    await advance(h, 15);
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers.length, 2);
    assert.ok(state.offers.every(o => o.status === "expired"));
    assert.equal(state.openings[0].status, "unfilled");
    assert.equal(state.offers[1].sentAt, first.deadlineAt);
    assert.equal(Date.parse(state.offers[1].deadlineAt) - Date.parse(state.offers[1].sentAt!), 5 * 60000);
    assert.equal(state.clockOffsetMs, 15 * 60000);
    assert.equal(projectClientOffer(state, first.id, await env.currentTimeMs())?.canRespond, false);
    assert.equal(state.messages?.filter(m => /Reply YES/.test(m.text)).length, 2);
    assert.equal(state.messages?.filter(m => /reply window ended/.test(m.text)).length, 2);
    assert.ok(state.messages?.every(m => /SIMULATED/.test(m.text)));
    await Worker.runReplayHistory({ workflowsPath: require.resolve("../src/workflows") }, await h.fetchHistory());
  });
});

test("question and later reply remain separately visible with send and response timestamps", async () => {
  await run("audit-message-history", async h => {
    await add(h, input("messages"));
    await h.signal("startOffers");
    const first = (await h.query(getSalonSnapshot)).offers[0];
    await advance(h, 2);
    await reply(h, first.id, "question");
    await advance(h, 1);
    await reply(h, first.id, "decline");
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers[0].status, "declined");
    assert.ok(Date.parse(state.offers[0].respondedAt!) >= Date.parse(first.sentAt!) + 3 * 60000);
    const trail = state.messages!.filter(m => m.offerId === first.id);
    assert.equal(trail.filter(m => m.direction === "incoming").length, 2);
    assert.match(trail[0].text, /Reply YES.*Reply deadline:/);
    assert.ok(trail.some(m => m.text.includes("Can I ask about the service?")));
    assert.equal(state.offers[1].clientName, "Jordan Lee");
  });
});

test("at the exact deadline acceptance cannot reserve; the next offer can win", async () => {
  await run("audit-boundary", async h => {
    await add(h, input("boundary"));
    await h.signal("startOffers");
    const first = (await h.query(getSalonSnapshot)).offers[0];
    await advance(h, 15);
    assert.equal((await reply(h, first.id, "accept")).code, "expired");
    const next = (await h.query(getSalonSnapshot)).offers[1];
    assert.equal((await reply(h, next.id, "accept")).code, "accepted");
    assert.equal((await reply(h, first.id, "accept")).code, "taken");
    assert.equal((await h.query(getSalonSnapshot)).openings[0].bookedClientId, next.clientId);
  });
});

test("manual Square checklist is only available for booked openings, persists and can reopen", async () => {
  await run("audit-square", async h => {
    const opening = await add(h, input("square"));
    const mark = (completed: boolean) => h.executeUpdate(recordSquareUpdate, { args: [{ openingId: opening.openingId!, completed, staff: "carla" }] });
    assert.equal((await mark(true)).recorded, false);
    await h.signal("startOffers");
    await reply(h, (await h.query(getSalonSnapshot)).offers[0].id, "accept");
    assert.equal((await mark(true)).recorded, true);
    const done = (await h.query(getSalonSnapshot)).openings[0];
    await mark(true);
    assert.equal((await h.query(getSalonSnapshot)).openings[0].squareUpdatedAt, done.squareUpdatedAt);
    assert.equal(done.squareUpdatedBy, "carla");
    await Worker.runReplayHistory({ workflowsPath: require.resolve("../src/workflows") }, await h.fetchHistory());
    await mark(false);
    assert.equal((await h.query(getSalonSnapshot)).openings[0].squareUpdatedAt, undefined);
  });
});

test("closing an opening releases its client for the next queued opening and blocks stale acceptance", async () => {
  await run("audit-release", async h => {
    const base = input("release-1", { stylist: "Rosa" });
    await add(h, base);
    await add(h, input("release-2", { stylist: "Rosa", startsAt: new Date(Date.parse(base.startsAt) + 3600000).toISOString() }));
    await h.signal("startOffers");
    const first = (await h.query(getSalonSnapshot)).offers[0];
    assert.equal((await h.query(getSalonSnapshot)).openings[1].status, "queued");
    await h.signal("cancelOpening", { openingId: first.openingId, offerId: first.id, stillOpen: false, reason: "Unavailable" });
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers[1].clientName, "Maya Rivera");
    assert.equal(state.offers[1].openingId, "opening-2");
    assert.equal((await reply(h, first.id, "accept")).code, "unavailable");
  });
});

test("API rejects malformed retry IDs and timestamps without a time zone", () => {
  for (const requestId of ["", "a".repeat(101), "../bad", 4]) assert.throws(() => normalizeOpening({ ...input("valid"), requestId }));
  assert.throws(() => normalizeOpening({ ...input("valid"), startsAt: "2030-01-01T10:00:00" }));
});

test("acceptance racing with staff closure ends in one consistent outcome", async () => {
  await run("audit-close-race", async h => {
    await add(h, input("close-race"));
    await h.signal("startOffers");
    const first = (await h.query(getSalonSnapshot)).offers[0];
    const [acceptance] = await Promise.all([
      reply(h, first.id, "accept"),
      h.signal("cancelOpening", { openingId: first.openingId, offerId: first.id, stillOpen: false, reason: "Stylist unavailable" }),
    ]);
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers.length, 1);
    if (acceptance.code === "accepted") {
      assert.equal(state.openings[0].status, "booked");
      assert.equal(state.openings[0].bookedClientId, first.clientId);
    } else {
      assert.equal(acceptance.code, "unavailable");
      assert.equal(state.openings[0].status, "closed");
      assert.equal(state.openings[0].bookedClientId, undefined);
    }
  });
});

test("worker restart preserves advanced simulation time and the original offer deadline", { timeout: 60000 }, async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = "audit-clock-restart";
  let h: Handle;
  let deadline: string;
  try {
    const firstWorker = await Worker.create({ connection: env.nativeConnection, taskQueue, maxCachedWorkflows: 0, workflowsPath: require.resolve("../src/workflows") });
    await firstWorker.runUntil(async () => {
      h = await env.client.workflow.start(juniperSalonWorkflow, { workflowId: taskQueue, taskQueue });
      await add(h, input("restart"));
      await h.signal("startOffers");
      deadline = (await h.query(getSalonSnapshot)).offers[0].deadlineAt;
      await advance(h, 7);
    });
    await env.sleep("2 minutes");
    const secondWorker = await Worker.create({ connection: env.nativeConnection, taskQueue, maxCachedWorkflows: 0, workflowsPath: require.resolve("../src/workflows") });
    await secondWorker.runUntil(async () => {
      const restored = await h.query(getSalonSnapshot);
      assert.equal(restored.clockOffsetMs, 7 * 60000);
      assert.equal(restored.offers[0].deadlineAt, deadline);
      assert.equal(restored.offers[0].status, "waiting");
      await env.sleep("6 minutes");
      const advanced = await h.query(getSalonSnapshot);
      assert.equal(advanced.offers[0].status, "expired");
      assert.equal(advanced.offers.length, 2);
      assert.equal(advanced.offers[1].clientName, "Jordan Lee");
      await h.cancel();
    });
  } finally { await env.teardown(); }
});
