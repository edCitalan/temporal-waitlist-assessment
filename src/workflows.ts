import {
  condition,
  defineQuery,
  defineSignal,
  setHandler,
} from "@temporalio/workflow";
import type {
  ClientReply,
  Opening,
  OpeningInput,
  Offer,
  SalonSnapshot,
  StaffCancellation,
  WaitlistEntry,
} from "./types";

const OFFER_WINDOW_MS = 15 * 60 * 1000;
const TASK_QUEUE = "assessment-starter";

export const createOpening = defineSignal<[OpeningInput]>("createOpening");
export const startOffers = defineSignal("startOffers");
export const replyToOffer = defineSignal<[ClientReply]>("replyToOffer");
export const cancelOpening = defineSignal<[StaffCancellation]>("cancelOpening");
export const getSalonSnapshot = defineQuery<SalonSnapshot>("getSalonSnapshot");

const sampleWaitlist: WaitlistEntry[] = [
  {
    id: "maya-rivera-haircut",
    name: "Maya Rivera",
    mobile: "(555) 010-2401",
    service: "Haircut",
    stylistPreference: "Any stylist",
    availability: "Weekdays",
    joinedAt: "2026-09-02T10:00:00.000Z",
    optedIn: true,
  },
  {
    id: "jordan-lee-haircut",
    name: "Jordan Lee",
    mobile: "(555) 010-2402",
    service: "Haircut",
    stylistPreference: "Jules",
    availability: "Any time",
    joinedAt: "2026-09-04T10:00:00.000Z",
    optedIn: true,
  },
  {
    id: "sam-patel-color",
    name: "Sam Patel",
    mobile: "(555) 010-2403",
    service: "Color",
    stylistPreference: "Any stylist",
    availability: "Weekday afternoons",
    joinedAt: "2026-09-01T10:00:00.000Z",
    optedIn: true,
  },
  {
    id: "riley-chen-haircut",
    name: "Riley Chen",
    mobile: "(555) 010-2404",
    service: "Haircut",
    stylistPreference: "Any stylist",
    availability: "Weekends",
    joinedAt: "2026-09-06T10:00:00.000Z",
    optedIn: true,
  },
  {
    id: "taylor-brooks-color",
    name: "Taylor Brooks",
    mobile: "(555) 010-2405",
    service: "Color",
    stylistPreference: "Jules",
    availability: "Any time",
    joinedAt: "2026-09-07T10:00:00.000Z",
    optedIn: true,
  },
  {
    id: "avery-kim-haircut",
    name: "Avery Kim",
    mobile: "(555) 010-2406",
    service: "Haircut",
    stylistPreference: "Any stylist",
    availability: "Any time",
    joinedAt: "2026-09-08T10:00:00.000Z",
    optedIn: false,
  },
  {
    id: "sam-patel-highlights",
    name: "Sam Patel",
    mobile: "(555) 010-2403",
    service: "Highlights",
    stylistPreference: "Any stylist",
    availability: "Weekday afternoons",
    joinedAt: "2026-09-03T10:00:00.000Z",
    optedIn: true,
  },
];

function matchesAvailability(entry: WaitlistEntry, startsAt: string): boolean {
  if (entry.availability === "Any time") return true;
  const date = new Date(startsAt);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  if (entry.availability === "Weekdays" && isWeekend) return false;
  if (entry.availability === "Weekends" && !isWeekend) return false;
  if (entry.availability === "Weekday afternoons") {
    return !isWeekend && date.getHours() >= 12;
  }
  return true;
}

function requestKey(clientId: string, service: string): string {
  return `${clientId}:${service}`;
}

export async function juniperSalonWorkflow(): Promise<void> {
  const waitlist = sampleWaitlist;
  const openings: Opening[] = [];
  const offers: Offer[] = [];
  const attemptedByOpening = new Map<string, Set<string>>();
  const activeServicesByClient = new Map<string, Set<string>>();
  const fulfilledRequests = new Set<string>();
  const replies = new Map<string, "accept" | "decline">();
  const cancellations = new Map<string, StaffCancellation>();
  let offersRunning = false;
  let lastUpdated = new Date().toISOString();

  const touch = () => {
    lastUpdated = new Date().toISOString();
  };
  const snapshot = (): SalonSnapshot => ({
    waitlist,
    openings,
    offers,
    offersRunning,
    lastUpdated,
  });

  const releaseClientService = (clientId: string, service: string) => {
    const services = activeServicesByClient.get(clientId);
    services?.delete(service);
    if (services?.size === 0) activeServicesByClient.delete(clientId);
  };

  const matchingRequests = (opening: Opening) =>
    waitlist
      .filter(
        (entry) =>
          entry.optedIn &&
          entry.service === opening.service &&
          (opening.stylist === "Any stylist" ||
            entry.stylistPreference === "Any stylist" ||
            entry.stylistPreference === opening.stylist) &&
          matchesAvailability(entry, opening.startsAt) &&
          !fulfilledRequests.has(requestKey(entry.id, entry.service)),
      )
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));

  const scheduleOpenings = () => {
    if (!offersRunning) return;
    const queued = openings
      .filter((opening) => opening.status === "queued")
      .sort((a, b) => {
        const byAppointment = Date.parse(a.startsAt) - Date.parse(b.startsAt);
        if (byAppointment !== 0) return byAppointment;
        const byCreated = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
      });

    for (const opening of queued) {
      const matching = matchingRequests(opening);
      const attempted = attemptedByOpening.get(opening.id) ?? new Set<string>();
      const candidate = matching.find((entry) => !attempted.has(entry.id));
      if (!candidate) {
        const waitingForClient = matching.some((entry) => {
          if (attempted.has(entry.id)) return false;
          return activeServicesByClient.get(entry.id)?.has(opening.service) ?? false;
        });
        if (!waitingForClient) {
          opening.status = "unfilled";
          opening.note = "No more opted-in clients match this opening.";
        }
        continue;
      }

      if (activeServicesByClient.get(candidate.id)?.has(opening.service)) continue;

      const services = activeServicesByClient.get(candidate.id) ?? new Set<string>();
      services.add(opening.service);
      activeServicesByClient.set(candidate.id, services);

      const offer: Offer = {
        id: `${opening.id}-offer-${offers.length + 1}`,
        openingId: opening.id,
        clientId: candidate.id,
        clientName: candidate.name,
        service: opening.service,
        stylist: opening.stylist,
        startsAt: opening.startsAt,
        deadlineAt: new Date(Date.now() + OFFER_WINDOW_MS).toISOString(),
        status: "waiting",
        message: `SIMULATED TEXT — Juniper Salon: ${opening.service} with ${opening.stylist} is available on ${opening.displayTime}. Accept or decline within 15 minutes. No real text was sent.`,
      };
      offers.push(offer);
      opening.currentOfferId = offer.id;
      opening.status = "offering";
      opening.note = `Waiting for ${candidate.name} for 15 minutes.`;
      touch();
      void resolveOffer(offer, opening, candidate);
    }
  };

  const resolveOffer = async (offer: Offer, opening: Opening, candidate: WaitlistEntry) => {
    const finished = await condition(
      () => replies.has(offer.id) || cancellations.has(opening.id),
      OFFER_WINDOW_MS,
    );
    const cancellation = cancellations.get(opening.id);
    if (cancellation) {
      offer.status = "cancelled";
      offer.message = "SIMULATED TEXT — This opening is no longer available. Please do not accept it. No real text was sent.";
      opening.currentOfferId = undefined;
      opening.status = cancellation.stillOpen ? "queued" : "closed";
      opening.note = cancellation.stillOpen
        ? `Offer cancelled (${cancellation.reason}); contacting the next eligible client.`
        : `Opening closed (${cancellation.reason}); no more clients will be contacted.`;
      cancellations.delete(opening.id);
      releaseClientService(candidate.id, opening.service);
      touch();
      scheduleOpenings();
      return;
    }

    if (!finished) {
      offer.status = "expired";
      offer.message = "SIMULATED TEXT — The 15-minute reply window ended. This opening is being offered to the next eligible client. No real text was sent.";
      opening.note = `${candidate.name} did not reply in 15 minutes; moving to the next person.`;
    } else if (replies.get(offer.id) === "accept") {
      offer.status = "accepted";
      opening.status = "booked";
      opening.bookedClientId = candidate.id;
      opening.note = `${candidate.name} accepted. Front desk staff must update Square.`;
      fulfilledRequests.add(requestKey(candidate.id, opening.service));
      offer.message = `SIMULATED TEXT — Your ${opening.service} with ${opening.stylist} at ${opening.displayTime} is reserved for you. Juniper front desk will update Square. No real text was sent.`;
    } else {
      offer.status = "declined";
      offer.message = "SIMULATED TEXT — Thanks for letting us know. We’ll offer this opening to the next eligible client. No real text was sent.";
      opening.note = `${candidate.name} declined; moving to the next person.`;
    }

    const attempted = attemptedByOpening.get(opening.id) ?? new Set<string>();
    attempted.add(candidate.id);
    attemptedByOpening.set(opening.id, attempted);
    replies.delete(offer.id);
    if (offer.status !== "accepted") {
      opening.currentOfferId = undefined;
      opening.status = "queued";
    }
    releaseClientService(candidate.id, opening.service);
    touch();
    scheduleOpenings();
  };

  setHandler(getSalonSnapshot, snapshot);
  setHandler(createOpening, (input) => {
    const opening: Opening = {
      ...input,
      id: `opening-${openings.length + 1}`,
      createdAt: new Date().toISOString(),
      status: "queued",
      note: "Queued. Start offers when you are ready.",
    };
    openings.push(opening);
    attemptedByOpening.set(opening.id, new Set<string>());
    touch();
    scheduleOpenings();
  });
  setHandler(startOffers, () => {
    offersRunning = true;
    openings.forEach((opening) => {
      if (opening.status === "unfilled") {
        opening.status = "queued";
        opening.note = "Queued for another matching client.";
      }
    });
    touch();
    scheduleOpenings();
  });
  setHandler(replyToOffer, (reply) => {
    const offer = offers.find((item) => item.id === reply.offerId);
    if (!offer || !["waiting", "needs-follow-up"].includes(offer.status)) return;
    if (reply.kind === "question") {
      offer.status = "needs-follow-up";
      offer.message = `SIMULATED CLIENT REPLY — ${reply.message?.trim() || "Can you tell me more?"} The slot is not reserved; staff follow-up is needed.`;
      touch();
      return;
    }
    replies.set(reply.offerId, reply.kind);
    touch();
  });
  setHandler(cancelOpening, (cancellation) => {
    const opening = openings.find((item) => item.id === cancellation.openingId);
    if (!opening || ["booked", "closed"].includes(opening.status)) return;
    cancellations.set(opening.id, cancellation);
    if (opening.status === "queued" || opening.status === "unfilled") {
      opening.status = cancellation.stillOpen ? "queued" : "closed";
      opening.note = cancellation.stillOpen
        ? `Staff cancelled an offer; ${cancellation.reason}.`
        : `Opening closed (${cancellation.reason}).`;
      cancellations.delete(opening.id);
      touch();
      scheduleOpenings();
    }
  });

  await condition(() => false);
}

export const salonTaskQueue = TASK_QUEUE;
