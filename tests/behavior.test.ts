import assert from "node:assert/strict";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { juniperSalonWorkflow, getSalonSnapshot, respondToOffer } from "../src/workflows";
import { normalizeOpening } from "../src/opening-input";
import type { OpeningInput, SalonSnapshot } from "../src/types";

type Handle = WorkflowHandle<typeof juniperSalonWorkflow>;
function opening(overrides: Partial<OpeningInput> = {}): OpeningInput {
  const date = new Date(Date.now() + 7 * 86400000);
  date.setUTCDate(date.getUTCDate() + (4 - date.getUTCDay() + 7) % 7);
  date.setUTCHours(22, 0, 0, 0);
  return { service: "Haircut", stylist: "Jules", startsAt: date.toISOString(), displayTime: "Thursday 3 PM Pacific", durationMinutes: 60, localDay: 4, localHour: 15, ...overrides };
}
async function scenario(name: string, run: (h: Handle, env: TestWorkflowEnvironment) => Promise<void>, inputs: OpeningInput[] = [opening()]) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: name, workflowsPath: require.resolve("../src/workflows") });
    await worker.runUntil(async () => {
      const h = await env.client.workflow.start(juniperSalonWorkflow, { workflowId: name, taskQueue: name });
      try {
        for (const input of inputs) await h.signal("createOpening", input);
        await h.signal("startOffers");
        await run(h, env);
      } finally { await h.cancel(); }
    });
  } finally { await env.teardown(); }
}
const reply = (h: Handle, offerId: string, kind: "accept" | "decline" | "question") => h.executeUpdate(respondToOffer, { args: [{ offerId, kind }] });

test("late replies report expired or taken and never replace the holder", async () => {
  await scenario("late-replies", async (h, env) => {
    const first = (await h.query(getSalonSnapshot)).offers[0];
    await env.sleep("15 minutes");
    let state = await h.query(getSalonSnapshot);
    assert.equal(state.offers[0].status, "expired");
    assert.equal(state.offers[1].clientName, "Jordan Lee");
    assert.equal((await reply(h, first.id, "accept")).code, "expired");
    assert.equal((await reply(h, state.offers[1].id, "accept")).code, "accepted");
    const late = await reply(h, first.id, "accept");
    assert.equal(late.code, "taken");
    assert.match(late.message, /SIMULATED.*already taken/);
    state = await h.query(getSalonSnapshot);
    assert.equal(state.openings[0].bookedClientId, "jordan-lee-haircut");
    assert.equal(state.offers.filter(o => o.status === "accepted").length, 1);
    assert.equal((await reply(h, "missing", "accept")).code, "not-found");
  });
});

test("15-minute durable timeouts advance automatically and exhaust the list", async () => {
  await scenario("timeouts", async (h, env) => {
    const first = (await h.query(getSalonSnapshot)).offers[0];
    await env.sleep("14 minutes");
    assert.equal((await h.query(getSalonSnapshot)).offers.length, 1);
    await env.sleep("1 minute");
    const next = await h.query(getSalonSnapshot);
    assert.equal(next.offers[0].status, "expired");
    assert.equal(next.offers[1].clientName, "Jordan Lee");
    assert.ok(Date.parse(next.offers[1].deadlineAt) >= Date.parse(first.deadlineAt) + 15 * 60000);
    await env.sleep("15 minutes");
    const exhausted = await h.query(getSalonSnapshot);
    assert.equal(exhausted.openings[0].status, "unfilled");
    assert.equal(exhausted.openings[0].currentOfferId, undefined);
    assert.equal(exhausted.offers.length, 2);
    assert.ok(exhausted.offers.every(o => o.status === "expired"));
    assert.match(exhausted.openings[0].note, /No more opted-in clients/);
  });
});

test("matching respects local day/hour, service, stylist, consent, and oldest request", async () => {
  await scenario("matching", async (h) => {
    let state = await h.query(getSalonSnapshot);
    assert.deepEqual(state.offers.map(o => o.clientName), ["Maya Rivera", "Sam Patel", "Jordan Lee", "Riley Chen"]);
    assert.ok(state.offers.every(o => o.clientName !== "Avery Kim"));
    assert.equal(state.openings[2].status, "unfilled"); // Color with Rosa in morning: Sam unavailable, Taylor wants Jules
    assert.equal(state.openings[3].status, "unfilled"); // Highlights in morning
    await reply(h, state.offers[1].id, "decline");
    state = await h.query(getSalonSnapshot);
    assert.equal(state.offers.at(-1)?.clientName, "Taylor Brooks");
  }, [opening({ stylist: "Rosa" }), opening({ service: "Color" }),
      opening({ service: "Color", stylist: "Rosa", localHour: 9 }),
      opening({ service: "Highlights", localHour: 9 }),
      opening({ localDay: 6 }), opening({ localDay: 6, stylist: "Rosa" })]);
});

test("staff-selected reply windows set each deadline and advance after timeout", async () => {
  for (const minutes of [5, 30]) {
    await scenario(`custom-window-${minutes}`, async (h, env) => {
      const before = await h.query(getSalonSnapshot);
      assert.equal(before.openings[0].responseMinutes, minutes);
      const first = before.offers[0];
      const remaining = Date.parse(first.deadlineAt) - await env.currentTimeMs();
      assert.ok(remaining <= minutes * 60000 && remaining > (minutes - 1) * 60000);
      assert.match(first.message, new RegExp(`within ${minutes} minutes`));
      assert.match(first.message, /SIMULATED TEXT.*YES.*NO/);
      await env.sleep(`${minutes - 1} minutes`);
      assert.equal((await h.query(getSalonSnapshot)).offers[0].status, "waiting");
      await env.sleep("1 minute");
      const after = await h.query(getSalonSnapshot);
      assert.equal(after.offers[0].status, "expired");
      assert.equal(after.offers[1].clientName, "Jordan Lee");
      assert.ok(Date.parse(after.offers[1].deadlineAt) >= Date.parse(first.deadlineAt) + minutes * 60000);
    }, [opening({ responseMinutes: minutes })]);
  }
});

test("earliest appointment wins priority; equal times use creation order", async () => {
  const later = opening();
  const earlier = opening({ startsAt: new Date(Date.parse(later.startsAt) - 3600000).toISOString() });
  await scenario("opening-order", async (h) => {
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers[0].openingId, "opening-2");
    assert.equal(state.offers[0].clientName, "Maya Rivera");
    assert.equal(state.offers[1].openingId, "opening-1");
    assert.equal(state.offers[1].clientName, "Jordan Lee");
    assert.equal(state.openings[2].status, "queued");
  }, [later, earlier, later]);
});

test("same person has one active offer per service; separate service requests may overlap", async () => {
  await scenario("service-locks", async (h) => {
    const state = await h.query(getSalonSnapshot);
    const sam = state.offers.filter(o => o.clientName === "Sam Patel");
    assert.deepEqual(sam.map(o => o.service).sort(), ["Color", "Highlights"]);
    assert.equal(state.offers.filter(o => o.service === "Color").length, 2);
    assert.equal(state.offers.find(o => o.openingId === "opening-2")?.clientName, "Taylor Brooks");
    assert.equal(state.openings[3].status, "queued");
  }, [opening({ service: "Color" }), opening({ service: "Color" }), opening({ service: "Highlights" }), opening({ service: "Color" })]);
});

test("competing and repeated responses cannot overwrite the first acceptance", async () => {
  await scenario("reply-races", async (h) => {
    const first = (await h.query(getSalonSnapshot)).offers[0];
    await reply(h, first.id, "decline");
    const second = (await h.query(getSalonSnapshot)).offers[1];
    const outcomes = await Promise.all([reply(h, first.id, "accept"), reply(h, second.id, "accept"), reply(h, second.id, "accept")]);
    assert.ok(["unavailable", "taken"].includes(outcomes[0].code));
    assert.equal(outcomes[1].code, "accepted");
    assert.equal(outcomes[2].code, "accepted");
    await reply(h, second.id, "decline");
    await h.signal("cancelOpening", { openingId: "opening-1", stillOpen: false, reason: "Stale staff click" });
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers.filter(o => o.status === "accepted").length, 1);
    assert.equal(state.openings[0].bookedClientId, second.clientId);
    assert.equal(state.openings[0].status, "booked");
  });
});

test("question requires staff follow-up without holding or extending the deadline", async () => {
  await scenario("question", async (h, env) => {
    const first = (await h.query(getSalonSnapshot)).offers[0];
    assert.equal((await reply(h, first.id, "question")).code, "follow-up");
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.openings[0].bookedClientId, undefined);
    assert.equal(state.offers[0].status, "needs-follow-up");
    assert.equal(state.offers[0].deadlineAt, first.deadlineAt);
    assert.match(state.openings[0].note, /Staff follow-up/);
    await env.sleep("15 minutes");
    assert.equal((await h.query(getSalonSnapshot)).offers[1].clientName, "Jordan Lee");
  });
});

test("retried cancellation cannot cancel the next offer; cancelled reply is clear", async () => {
  await scenario("cancellation-retry", async (h) => {
    const first = (await h.query(getSalonSnapshot)).offers[0];
    const cancellation = { openingId: first.openingId, offerId: first.id, stillOpen: true, reason: "Try next" };
    await h.signal("cancelOpening", cancellation);
    await h.signal("cancelOpening", cancellation);
    const state = await h.query(getSalonSnapshot);
    assert.equal(state.offers.length, 2);
    assert.equal(state.offers[1].status, "waiting");
    assert.equal((await reply(h, first.id, "accept")).code, "unavailable");
  });
});

test("staff cutoff shortens the reply window and closes queued or active openings", async () => {
  await scenario("cutoff", async (h, env) => {
    const until = new Date(await env.currentTimeMs() + 5 * 60000).toISOString();
    await h.signal("createOpening", opening({ offerUntil: until }));
    await h.signal("createOpening", opening({ service: "Highlights", localHour: 9, offerUntil: until }));
    const before = await h.query(getSalonSnapshot);
    assert.equal(before.offers[0].deadlineAt, until);
    await env.sleep("5 minutes");
    const after = await h.query(getSalonSnapshot);
    assert.ok(after.openings.every(o => o.status === "closed"));
    assert.equal(after.offers.length, 1);
    assert.notEqual((await reply(h, before.offers[0].id, "accept")).code, "accepted");
  }, []);
});

test("API normalization validates inputs and calculates Pacific availability across UTC midnight", () => {
  const base = { ...opening(), startsAt: "2030-01-05T03:00:00.000Z", timeZone: "America/Los_Angeles", displayTime: "untrusted", localDay: 0 };
  const normalized = normalizeOpening(base, 0);
  assert.equal(normalized.localDay, 5); // Friday evening locally, Saturday in UTC
  assert.equal(normalized.localHour, 19);
  assert.match(normalized.displayTime, /Fri/);
  assert.notEqual(normalized.displayTime, "untrusted");
  assert.equal(normalized.responseMinutes, 15);
  assert.equal(normalizeOpening({ ...base, responseMinutes: 7 }, 0).responseMinutes, 7);
  for (const responseMinutes of [0, -1, 1.5, 1441, "15", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => normalizeOpening({ ...base, responseMinutes }, 0), /reply window/);
  }
  for (const invalid of [null, { ...base, stylist: "Any stylist" }, { ...base, startsAt: "bad" }, { ...base, durationMinutes: -1 }, { ...base, timeZone: "invalid" }, { ...base, offerUntil: "2031-01-01T00:00:00Z" }]) {
    assert.throws(() => normalizeOpening(invalid, 0));
  }
  assert.throws(() => normalizeOpening(base, Date.parse(base.startsAt) + 1));
});

test("worker restart replays state, preserves deadline, and advances once after timeout", { timeout: 60000 }, async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const taskQueue = "restart-proof";
  let h: Handle;
  let before: SalonSnapshot;
  try {
    const worker1 = await Worker.create({ connection: env.nativeConnection, taskQueue, maxCachedWorkflows: 0, workflowsPath: require.resolve("../src/workflows") });
    await worker1.runUntil(async () => {
      h = await env.client.workflow.start(juniperSalonWorkflow, { workflowId: taskQueue, taskQueue });
      await h.signal("createOpening", opening());
      await h.signal("startOffers");
      before = await h.query(getSalonSnapshot);
    }); // Worker has fully shut down and its workflow memory is gone.
    await env.sleep("5 minutes");
    const worker2 = await Worker.create({ connection: env.nativeConnection, taskQueue, maxCachedWorkflows: 0, workflowsPath: require.resolve("../src/workflows") });
    await worker2.runUntil(async () => {
      const after = await h.query(getSalonSnapshot);
      assert.deepEqual(after.offers, before.offers);
      assert.equal(after.openings[0].currentOfferId, before.openings[0].currentOfferId);
      await env.sleep("10 minutes");
      const advanced = await h.query(getSalonSnapshot);
      assert.equal(advanced.offers.length, 2);
      assert.equal(advanced.offers[0].status, "expired");
      assert.equal(advanced.offers[1].clientName, "Jordan Lee");
      await Worker.runReplayHistory({ workflowsPath: require.resolve("../src/workflows") }, await h.fetchHistory());
      await h.cancel();
    });
  } finally { await env.teardown(); }
});
