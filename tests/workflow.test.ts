import assert from "node:assert/strict";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import {
  getSalonSnapshot,
  juniperSalonWorkflow,
  salonTaskQueue,
} from "../src/workflows";
import type { SalonSnapshot } from "../src/types";

function futureThursday(): string {
  const date = new Date(Date.now() + 7 * 86400000);
  date.setUTCDate(date.getUTCDate() + (4 - date.getUTCDay() + 7) % 7);
  date.setUTCHours(22, 0, 0, 0);
  return date.toISOString();
}

test("an opening offers to the earliest matching opt-in client and acceptance reserves it", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: salonTaskQueue,
      workflowsPath: require.resolve("../src/workflows"),
    });

    await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start(juniperSalonWorkflow, {
        workflowId: "juniper-salon-test",
        taskQueue: salonTaskQueue,
        args: [],
      });
      await handle.signal("createOpening", {
        service: "Haircut",
        stylist: "Rosa",
        startsAt: futureThursday(),
        displayTime: "Thursday, 3:00 PM Pacific",
        durationMinutes: 60,
      });
      await handle.signal("startOffers");

      const offered = await handle.query<SalonSnapshot>(getSalonSnapshot);
      assert.equal(offered.offers[0]?.clientName, "Maya Rivera");
      assert.match(offered.offers[0]?.message ?? "", /SIMULATED TEXT/);
      assert.equal(offered.openings[0]?.status, "offering");

      await handle.signal("replyToOffer", {
        offerId: offered.offers[0].id,
        kind: "accept",
      });
      const accepted = await handle.query<SalonSnapshot>(getSalonSnapshot);
      assert.equal(accepted.offers[0]?.status, "accepted");
      assert.equal(accepted.openings[0]?.status, "booked");
      assert.match(accepted.openings[0]?.note ?? "", /update Square/);
      await handle.cancel();
    });
  } finally {
    await environment.teardown();
  }
});

async function withCancellationScenario(
  workflowId: string,
  scenario: (
    handle: WorkflowHandle<typeof juniperSalonWorkflow>,
    environment: TestWorkflowEnvironment,
  ) => Promise<void>,
): Promise<void> {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: salonTaskQueue,
      workflowsPath: require.resolve("../src/workflows"),
    });
    await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start(juniperSalonWorkflow, {
        workflowId,
        taskQueue: salonTaskQueue,
        args: [],
      });
      try {
        await handle.signal("createOpening", {
          service: "Haircut",
          stylist: "Jules",
          startsAt: futureThursday(),
          displayTime: "Thursday, 3:00 PM Pacific",
          durationMinutes: 60,
        });
        await handle.signal("startOffers");
        await scenario(handle, environment);
      } finally {
        await handle.cancel();
      }
    });
  } finally {
    await environment.teardown();
  }
}

test("cancel and try next skips each cancelled client and stops when the eligible list is exhausted", async () => {
  await withCancellationScenario("cancel-and-try-next", async (handle) => {
    const before = await handle.query(getSalonSnapshot);
    assert.equal(before.offers[0].clientName, "Maya Rivera");

    await handle.signal("cancelOpening", {
      openingId: before.openings[0].id,
      stillOpen: true,
      reason: "Staff cancelled this client offer",
    });
    const next = await handle.query(getSalonSnapshot);
    assert.equal(next.offers[0].status, "cancelled");
    assert.match(next.offers[0].message, /SIMULATED TEXT.*no longer available/);
    assert.equal(next.offers[1].clientName, "Jordan Lee");
    assert.equal(next.offers[1].status, "waiting");
    assert.equal(next.openings[0].currentOfferId, next.offers[1].id);

    await handle.signal("cancelOpening", {
      openingId: before.openings[0].id,
      stillOpen: true,
      reason: "Staff cancelled the next client offer",
    });
    const exhausted = await handle.query(getSalonSnapshot);
    assert.equal(exhausted.openings[0].status, "unfilled");
    assert.equal(exhausted.openings[0].currentOfferId, undefined);
    assert.equal(exhausted.offers.length, 2);
    assert.ok(exhausted.offers.every((offer) => offer.status === "cancelled"));
  });
});

test("close opening cancels its active offer and stays closed beyond the reply deadline", async () => {
  await withCancellationScenario("close-opening", async (handle, environment) => {
    const before = await handle.query(getSalonSnapshot);
    await handle.signal("cancelOpening", {
      openingId: before.openings[0].id,
      stillOpen: false,
      reason: "The stylist is unavailable",
    });
    const closed = await handle.query(getSalonSnapshot);
    assert.equal(closed.openings[0].status, "closed");
    assert.equal(closed.openings[0].currentOfferId, undefined);
    assert.equal(closed.offers[0].status, "cancelled");
    assert.match(closed.offers[0].message, /Please do not accept it/);

    await environment.sleep("16 minutes");
    await handle.signal("startOffers");
    const later = await handle.query(getSalonSnapshot);
    assert.equal(later.openings[0].status, "closed");
    assert.equal(later.offers.length, 1);
    assert.equal(later.offers[0].status, "cancelled");
  });
});
