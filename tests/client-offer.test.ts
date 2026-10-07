import assert from "node:assert/strict";
import { test } from "node:test";
import { createOfferLinks, projectClientOffer } from "../src/client-offer";
import type { SalonSnapshot } from "../src/types";

const claims = { workflowId: "salon-test", runId: "specific-run", offerId: "offer-1" };
const secret = "a".repeat(64);
function fixture(): SalonSnapshot {
  return {
    offersRunning: true, lastUpdated: "2030-01-01T00:00:00Z",
    waitlist: [{ id: "private-client", name: "Other person", mobile: "555-private", service: "Haircut", stylistPreference: "Any stylist", availability: "Any time", optedIn: true, joinedAt: "2029-01-01T00:00:00Z" }],
    openings: [{ id: "opening-1", service: "Haircut", stylist: "Jules", startsAt: "2030-01-02T22:00:00Z", displayTime: "Wednesday 2 PM Pacific", durationMinutes: 60, createdAt: "2030-01-01T00:00:00Z", status: "offering", currentOfferId: "offer-1", note: "Private staff note" }],
    offers: [{ id: "offer-1", openingId: "opening-1", clientId: "maya", clientName: "Maya Rivera", service: "Haircut", stylist: "Jules", startsAt: "2030-01-02T22:00:00Z", deadlineAt: "2030-01-01T00:15:00Z", status: "waiting", message: "SIMULATED TEXT" }],
  };
}

test("client link binds to one workflow run and offer and survives signer recreation", () => {
  const token = createOfferLinks(secret).issue(claims);
  assert.deepEqual(createOfferLinks(secret).verify(token), claims);
});

test("tampered, malformed and differently signed client links are rejected", () => {
  const links = createOfferLinks(secret);
  const token = links.issue(claims);
  const signature = token.split(".")[1];
  const changed = Buffer.from(JSON.stringify({ ...claims, offerId: "offer-2" })).toString("base64url");
  assert.equal(links.verify(`${changed}.${signature}`), undefined);
  assert.equal(createOfferLinks("b".repeat(64)).verify(token), undefined);
  for (const value of ["", "garbage", "a".repeat(3000), "%%%...", token + "x"]) assert.equal(links.verify(value), undefined);
});

test("client view includes exact offer details but excludes waitlist, staff notes and phone numbers", () => {
  const view = projectClientOffer(fixture(), "offer-1", Date.parse("2030-01-01T00:01:00Z"))!;
  assert.equal(view.clientName, "Maya Rivera");
  assert.equal(view.canRespond, true);
  assert.equal(view.durationMinutes, 60);
  assert.equal(view.simulated, true);
  const serialized = JSON.stringify(view);
  for (const privateValue of ["Other person", "555-private", "Private staff note", "waitlist", "clientId"]) assert.ok(!serialized.includes(privateValue));
  assert.equal(projectClientOffer(fixture(), "other-offer"), undefined);
});

test("client status reflects expiry, staff follow-up, acceptance, competing holder and closure", () => {
  const state = fixture();
  const before = Date.parse("2030-01-01T00:01:00Z");
  assert.equal(projectClientOffer(state, "offer-1", Date.parse("2030-01-01T00:15:00Z"))?.status, "expired");
  state.offers[0].status = "needs-follow-up";
  assert.equal(projectClientOffer(state, "offer-1", before)?.canRespond, true);
  state.openings[0].status = "booked";
  assert.equal(projectClientOffer(state, "offer-1", before)?.status, "taken");
  state.offers[0].status = "accepted";
  assert.equal(projectClientOffer(state, "offer-1", before)?.status, "accepted");
  assert.equal(projectClientOffer(state, "offer-1", before)?.canRespond, false);
  state.offers[0].status = "cancelled";
  state.openings[0].status = "closed";
  assert.equal(projectClientOffer(state, "offer-1", before)?.status, "unavailable");
});

test("client view expires by the simulation clock even before the wall-clock deadline", () => {
  const state = fixture();
  state.clockOffsetMs = 15 * 60000;
  const view = projectClientOffer(state, "offer-1", Date.parse("2030-01-01T00:01:00Z"));
  assert.equal(view?.status, "expired");
  assert.equal(view?.canRespond, false);
});
