import assert from "node:assert/strict";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  getSalonSnapshot,
  juniperSalonWorkflow,
  salonTaskQueue,
} from "../src/workflows";
import type { SalonSnapshot } from "../src/types";

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
        startsAt: "2026-10-08T22:00:00.000Z",
        displayTime: "Thu, Oct 8, 3:00 PM",
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
