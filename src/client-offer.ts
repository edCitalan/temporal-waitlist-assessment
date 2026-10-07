import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SalonSnapshot } from "./types";

type OfferLink = { workflowId: string; runId: string; offerId: string };
export function loadOfferLinkSecret(): string {
  const file = path.resolve(".local/client-link-secret.txt");
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  const secret = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Invalid local client-link secret.");
  return secret;
}

export function createOfferLinks(secret: string) {
  const sign = (value: string) => createHmac("sha256", secret).update(value).digest("base64url");
  return {
    issue(claims: OfferLink): string {
      const value = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return `${value}.${sign(value)}`;
    },
    verify(token: string): OfferLink | undefined {
      if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return;
      const [value, signature] = token.split(".");
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value)))) return;
      try {
        const claims = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (![claims.workflowId, claims.runId, claims.offerId].every(x => typeof x === "string" && x.length > 0)) return;
        return { workflowId: claims.workflowId, runId: claims.runId, offerId: claims.offerId };
      } catch { return; }
    },
  };
}

/** Only this client's offer is exposed; never the waitlist, other recipients or staff notes. */
export function projectClientOffer(snapshot: SalonSnapshot, offerId: string, now = Date.now()) {
  const offer = snapshot.offers.find(o => o.id === offerId);
  const opening = snapshot.openings.find(o => o.id === offer?.openingId);
  if (!offer || !opening) return;
  let status: string = offer.status;
  if (offer.status !== "accepted") {
    if (opening.status === "booked") status = "taken";
    else if (opening.status === "closed" || offer.status === "cancelled") status = "unavailable";
    else if (["waiting", "needs-follow-up"].includes(status) && now >= Date.parse(offer.deadlineAt)) status = "expired";
  }
  return {
    clientName: offer.clientName, service: offer.service, stylist: offer.stylist,
    startsAt: offer.startsAt, displayTime: opening.displayTime, timeZone: opening.timeZone,
    durationMinutes: opening.durationMinutes, deadlineAt: offer.deadlineAt, status,
    canRespond: ["waiting", "needs-follow-up"].includes(status) && opening.status === "offering" && opening.currentOfferId === offer.id,
    simulated: true,
  };
}
