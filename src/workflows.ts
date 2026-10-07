import { condition, defineQuery, defineSignal, defineUpdate, patched, setHandler } from "@temporalio/workflow";
import { legacySalonWorkflow, sampleWaitlist } from "./legacy-workflow";
import type { ClientReply, Opening, OpeningInput, OpeningResult, Offer, ReplyResult, SalonSnapshot, SimulatedMessage, StaffCancellation, WaitlistEntry } from "./types";

export const salonTaskQueue = "assessment-starter";
export const createOpening = defineSignal<[OpeningInput]>("createOpening");
export const startOffers = defineSignal("startOffers");
export const replyToOffer = defineSignal<[ClientReply]>("replyToOffer");
export const respondToOffer = defineUpdate<ReplyResult, [ClientReply]>("respondToOffer");
export const cancelOpening = defineSignal<[StaffCancellation]>("cancelOpening");
export const getSalonSnapshot = defineQuery<SalonSnapshot>("getSalonSnapshot");
export const submitOpening = defineUpdate<OpeningResult, [OpeningInput]>("submitOpening");
export const advanceSimulation = defineUpdate<{ clockNow: string }, [number]>("advanceSimulation");
export const recordSquareUpdate = defineUpdate<{ recorded: boolean }, [{ openingId: string; completed: boolean; staff: "lena" | "carla" }]>("recordSquareUpdate");

function matches(entry: WaitlistEntry, opening: Opening): boolean {
  // The API supplies salon-local calendar fields; old saved openings used UTC.
  const date = new Date(opening.startsAt);
  const day = opening.localDay ?? date.getUTCDay();
  const hour = opening.localHour ?? date.getUTCHours();
  const weekend = day === 0 || day === 6;
  return entry.optedIn && entry.service === opening.service &&
    (entry.stylistPreference === "Any stylist" || entry.stylistPreference === opening.stylist) &&
    (entry.availability === "Any time" ||
      (entry.availability === "Weekdays" && !weekend) ||
      (entry.availability === "Weekends" && weekend) ||
      (entry.availability === "Weekday afternoons" && !weekend && hour >= 12));
}

export async function juniperSalonWorkflow(initial?: SalonSnapshot): Promise<void> {
  if (!patched("reliable-offers-v2")) return legacySalonWorkflow();
  const waitlist = initial?.waitlist ?? sampleWaitlist;
  const openings: Opening[] = initial?.openings ?? [];
  const offers: Offer[] = initial?.offers ?? [];
  const messages: SimulatedMessage[] = initial?.messages ?? [];
  let clockOffsetMs = initial?.clockOffsetMs ?? 0;
  const now = () => Date.now() + clockOffsetMs;
  const timestamp = () => new Date(now()).toISOString();
  let offersRunning = initial?.offersRunning ?? false;
  let lastUpdated = initial?.lastUpdated ?? new Date().toISOString();
  let revision = 0;
  const touch = () => { lastUpdated = timestamp(); revision++; };
  const isActive = (offer: Offer) => ["waiting", "needs-follow-up"].includes(offer.status);
  const cutoff = (opening: Opening) => Math.min(Date.parse(opening.startsAt), Date.parse(opening.offerUntil ?? opening.startsAt));
  // A normalized mobile identifies one person across the seeded service requests.
  const person = (id: string) => waitlist.find((entry) => entry.id === id)?.mobile.replace(/\D/g, "") ?? id;
  const sameRequest = (offer: Offer, entry: WaitlistEntry) => person(offer.clientId) === person(entry.id) && offer.service === entry.service;
  const simulated = (message: string) => `SIMULATED TEXT — ${message} No real text was sent.`;
  const log = (openingId: string, text: string, direction: SimulatedMessage["direction"], offer?: Offer) => {
    messages.push({ id: `message-${messages.length + 1}`, openingId, offerId: offer?.id,
      clientName: offer?.clientName, at: timestamp(), direction, text });
  };

  function close(opening: Opening, reason: string) {
    const offer = offers.find((item) => item.id === opening.currentOfferId && isActive(item));
    if (offer) {
      offer.status = "cancelled";
      offer.message = simulated("This opening is no longer available. Please do not accept it.");
      log(opening.id, offer.message, "outgoing", offer);
    }
    opening.status = "closed";
    opening.currentOfferId = undefined;
    opening.note = reason;
    touch();
  }

  function schedule() {
    for (const opening of openings) {
      if (!["booked", "closed"].includes(opening.status) && now() >= cutoff(opening)) {
        close(opening, "The last practical response time has passed. No more offers will be sent.");
      }
    }
    if (!offersRunning) return;
    // Stable sort preserves creation order when both timestamps tie.
    const queued = openings.filter((o) => o.status === "queued").sort((a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const opening of queued) {
      const eligible = waitlist.filter((entry) => matches(entry, opening) &&
        !offers.some((offer) => offer.openingId === opening.id && sameRequest(offer, entry)) &&
        !offers.some((offer) => offer.status === "accepted" && sameRequest(offer, entry)))
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
      const candidate = eligible.find((entry) => !offers.some((offer) => isActive(offer) && sameRequest(offer, entry)));
      if (!candidate) {
        opening.status = eligible.length ? "queued" : "unfilled";
        opening.note = eligible.length ? "Matching clients already have an offer for this service. Waiting for their outcome." : "No more opted-in clients match this opening.";
        touch();
        continue;
      }
      const deadlineAt = new Date(Math.min(now() + (opening.responseMinutes ?? 15) * 60000, cutoff(opening))).toISOString();
      const offer: Offer = {
        id: `${opening.id}-offer-${offers.length + 1}`, openingId: opening.id,
        clientId: candidate.id, clientName: candidate.name, service: opening.service,
        stylist: opening.stylist, startsAt: opening.startsAt, deadlineAt, sentAt: timestamp(), status: "waiting",
        message: simulated(`Juniper Salon: ${opening.service} with ${opening.stylist} is available on ${opening.displayTime}. Reply YES to accept this exact appointment or NO to decline within ${Math.ceil((Date.parse(deadlineAt) - now()) / 60000)} minutes. Reply deadline: ${deadlineAt} (UTC).`),
      };
      offers.push(offer);
      log(opening.id, offer.message, "outgoing", offer);
      opening.currentOfferId = offer.id;
      opening.status = "offering";
      opening.note = `Waiting for ${candidate.name}; the exact reply deadline is shown on the offer.`;
      touch();
    }
  }

  function expire(offer: Offer) {
    if (!isActive(offer)) return;
    const opening = openings.find((o) => o.id === offer.openingId)!;
    offer.status = "expired";
    offer.message = simulated("The reply window ended. This offer can no longer be accepted.");
    log(opening.id, offer.message, "outgoing", offer);
    opening.currentOfferId = undefined;
    opening.status = "queued";
    touch();
    schedule();
  }

  function respond(reply: ClientReply): ReplyResult {
    const offer = offers.find((item) => item.id === reply.offerId);
    if (!offer) return { code: "not-found", message: simulated("This offer was not found. Please contact salon staff.") };
    const opening = openings.find((item) => item.id === offer.openingId)!;
    log(opening.id, `SIMULATED CLIENT REPLY — ${reply.kind === "question" ? reply.message?.trim() || "Can you tell me more?" : reply.kind === "accept" ? "YES to this exact appointment" : "NO"}`, "incoming", offer);
    if (isActive(offer) && now() < Date.parse(offer.deadlineAt)) offer.respondedAt = timestamp();
    const result = (code: ReplyResult["code"], message: string): ReplyResult => {
      const value = { code, message: simulated(message) };
      offer.lastReply = value;
      log(opening.id, value.message, "outgoing", offer);
      touch();
      return value;
    };
    if (isActive(offer) && now() >= Date.parse(offer.deadlineAt)) expire(offer);
    if (opening.status === "booked") {
      if (offer.status === "accepted") return result("accepted", `This appointment remains reserved for ${offer.clientName}. Front desk staff must update Square.`);
      return result("taken", "This appointment was already taken. You do not hold this opening.");
    }
    if (offer.status === "expired") return result("expired", "Your reply arrived after the deadline. This offer has expired and does not reserve the appointment.");
    if (!isActive(offer) || opening.status === "closed") return result("unavailable", "This offer is no longer available. You do not hold this opening.");
    if (reply.kind === "question") {
      offer.status = "needs-follow-up";
      opening.note = `${offer.clientName} asked a question. Staff follow-up needed; no reservation yet.`;
      offer.message = `SIMULATED CLIENT REPLY — ${reply.message?.trim() || "Can you tell me more?"} Staff follow-up needed. No reservation; the original deadline continues.`;
      return result("follow-up", "Staff will need to follow up. Your question does not reserve this opening; the original deadline still applies.");
    }
    // Synchronous state transition: subsequent replies immediately see the decided outcome.
    if (reply.kind === "accept") {
      offer.status = "accepted";
      opening.status = "booked";
      opening.bookedClientId = offer.clientId;
      opening.note = `${offer.clientName} accepted. Front desk staff must update Square.`;
      offer.message = simulated(`Your ${opening.service} with ${opening.stylist} at ${opening.displayTime} is reserved for you. Front desk staff will update Square.`);
      const outcome = result("accepted", `Your ${opening.service} at ${opening.displayTime} is reserved for you. Front desk staff must update Square.`);
      schedule();
      return outcome;
    }
    offer.status = "declined";
    offer.message = simulated("Thanks for letting us know. We will try the next eligible client.");
    opening.currentOfferId = undefined;
    opening.status = "queued";
    const outcome = result("declined", "Your decline was recorded. You do not hold this opening.");
    schedule();
    return outcome;
  }

  setHandler(getSalonSnapshot, () => ({ waitlist, openings, offers, offersRunning, lastUpdated, messages, clockOffsetMs, clockNow: timestamp() }));
  function addOpening(input: OpeningInput): OpeningResult {
    const prior = input.requestId && openings.find(o => o.requestId === input.requestId);
    if (prior) {
      const same = ["service", "stylist", "startsAt", "durationMinutes", "responseMinutes", "offerUntil", "timeZone"].every(key => prior[key as keyof Opening] === input[key as keyof OpeningInput]);
      return { code: same ? "duplicate" : "conflict", openingId: prior.id, message: same ? "This opening was already added." : "This request ID was already used for different appointment details." };
    }
    if (input.requestId && Date.parse(input.offerUntil ?? input.startsAt) <= now()) {
      return { code: "conflict", message: "Choose an appointment and practical cutoff after the displayed simulation time." };
    }
    // New requests use IDs; legacy history without them must replay unchanged.
    const duplicateSlot = input.requestId && openings.find(o => o.stylist === input.stylist && o.startsAt === input.startsAt && o.status !== "closed");
    if (duplicateSlot) return { code: "conflict", openingId: duplicateSlot.id, message: "This stylist already has an opening at that exact time. View the existing opening." };
    const opening: Opening = { ...input, id: `opening-${openings.length + 1}`, createdAt: timestamp(), status: "queued", note: "Queued. Start offers when you are ready." };
    openings.push(opening);
    touch();
    schedule();
    return { code: "created", openingId: opening.id, message: "Opening added." };
  }
  setHandler(createOpening, (input) => { addOpening(input); });
  setHandler(submitOpening, (input) => {
    if (!input.requestId) return { code: "conflict", message: "An opening request ID is required." };
    return addOpening(input);
  });
  setHandler(startOffers, () => { offersRunning = true; touch(); schedule(); });
  setHandler(respondToOffer, respond);
  setHandler(replyToOffer, (reply) => { respond(reply); });
  setHandler(cancelOpening, (cancellation) => {
    const opening = openings.find((item) => item.id === cancellation.openingId);
    if (!opening || ["booked", "closed"].includes(opening.status)) return;
    if (cancellation.offerId && cancellation.offerId !== opening.currentOfferId) return;
    if (!cancellation.stillOpen) close(opening, `Opening closed (${cancellation.reason}); no more clients will be contacted.`);
    else {
      const offer = offers.find((item) => item.id === opening.currentOfferId && isActive(item));
      if (!offer) return;
      offer.status = "cancelled";
      offer.message = simulated("This opening is no longer available. Please do not accept it.");
      log(opening.id, offer.message, "outgoing", offer);
      opening.currentOfferId = undefined;
      opening.status = "queued";
      touch();
    }
    schedule();
  });

  setHandler(recordSquareUpdate, ({ openingId, completed, staff }) => {
    const opening = openings.find(o => o.id === openingId);
    if (!opening || opening.status !== "booked" || !["lena", "carla"].includes(staff)) return { recorded: false };
    if (Boolean(opening.squareUpdatedAt) !== completed) {
      opening.squareUpdatedAt = completed ? timestamp() : undefined;
      opening.squareUpdatedBy = completed ? staff : undefined;
      const clientName = waitlist.find(entry => entry.id === opening.bookedClientId)?.name || "The client";
      opening.note = completed ? `${clientName} accepted. Staff marked the manual Square update done.` : `${clientName} accepted. Front desk staff must update Square.`;
      log(opening.id, `SIMULATED STAFF RECORD — ${staff === "lena" ? "Lena" : "Carla"} ${completed ? "marked the manual Square update done" : "reopened the manual Square checklist"}. No connection to Square was made.`, "staff");
      touch();
    }
    return { recorded: true };
  });

  setHandler(advanceSimulation, (minutes) => {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Advance by 1 to 1440 whole minutes.");
    const target = now() + minutes * 60000;
    // Visit every intervening deadline so a 15-minute jump also handles 5-minute offers correctly.
    for (;;) {
      const next = Math.min(...offers.filter(isActive).map(o => Date.parse(o.deadlineAt)),
        ...openings.filter(o => !["booked", "closed"].includes(o.status)).map(cutoff));
      if (next > target) break;
      clockOffsetMs += Math.max(0, next - now());
      for (const offer of offers.filter(isActive)) if (now() >= Date.parse(offer.deadlineAt)) expire(offer);
      schedule();
    }
    clockOffsetMs = target - Date.now();
    touch();
    schedule();
    return { clockNow: timestamp() };
  });

  // One durable timer watches the next deadline. Replies/cancellations wake the loop.
  // Restored snapshots retain absolute deadlines, including elapsed downtime.
  for (;;) {
    for (const offer of offers.filter(isActive)) {
      if (now() >= Date.parse(offer.deadlineAt)) expire(offer);
    }
    schedule();
    const deadlines = [
      ...offers.filter(isActive).map(o => Date.parse(o.deadlineAt)),
      ...openings.filter(o => !["booked", "closed"].includes(o.status)).map(cutoff),
    ];
    const seenRevision = revision;
    if (deadlines.length) await condition(() => revision !== seenRevision, Math.max(1, Math.min(...deadlines) - now()));
    else await condition(() => revision !== seenRevision);
  }
}
