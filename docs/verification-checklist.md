# Juniper prototype verification checklist

Only mark an item complete after its stated behavior is observed. Edward authorized completing the whole list with behavior tests and checkpoint updates on October 7, 2026.

## Latest 12-rule specification: verified October 7, 2026

The missing configurable reply window is implemented. Type checking passed, all 26 automated tests passed, and all 14 browser/API check groups passed. Existing local Temporal history replayed successfully, and the restarted app preserved the demo records.

| Complete | Requirement | Evidence |
| --- | --- | --- |
| [x] | 1. Staff enter service, stylist, date/time and response window. | Browser sets seven minutes and confirms the resulting workflow/client deadline. Automated tests cover five, fifteen and thirty minutes, plus invalid input. |
| [x] | 2. One oldest eligible opted-in client at a time per opening. | Matching test covers service, stylist, local availability, consent and oldest request. |
| [x] | 3. Exact appointment details, deadline and clear YES/NO options. | Outgoing offer says YES/NO; the client page shows service, stylist, appointment and deadline with accept/decline controls. Browser and visual checks passed. |
| [x] | 4. Clear acceptance reserves, stops offers and tells staff to update Square. | Workflow and browser checks identify Jordan as the holder and show the Square reminder. |
| [x] | 5. Decline or timeout advances automatically. | Browser decline advances to Jordan; accelerated Temporal tests verify default and custom deadlines. |
| [x] | 6. Questions flag staff follow-up without reserving. | A client types a question; staff see it with no holder. The offer stays open until its original deadline or staff cancellation. |
| [x] | 7. One active offer per person per service. | Same-service conflicts are blocked; Sam's separate Color and Highlights requests can receive offers concurrently. |
| [x] | 8. Earlier appointment first, then creation order. | Workflow ordering test covers both cases for queued openings. |
| [x] | 9. Cancelled offers cannot accept; continue only if still open. | Cancellation tests cover try-next, close-opening, stale acceptance and repeated cancellation. Client page removes response controls. |
| [x] | 10. Opted-out clients are never contacted. | Matching excludes Avery, the opted-out seed client. |
| [x] | 11. First valid acceptance wins; losing replies get taken; holder visible. | Concurrent/repeated and late-reply tests preserve one holder; the losing client's page shows already taken. |
| [x] | 12. Every simulated message is clearly labeled. | Workflow message assertions and browser/visual review confirm simulation labels on staff and client views. |

### Deliverables and final publication

- [x] Working local app with meaningful Temporal workflows and timers; protected Lena/Carla dashboard and personal client offer pages.
- [x] README with startup, local staff login, client-reply and timeout demonstrations, assumptions and prototype limits.
- [x] Six fictional clients / seven service requests with fake contacts, including an opted-out client.
- [x] Passing tests, including staff access, the twelve rules, client-link isolation, restart and replay.
- [x] Staff and client desktop/mobile screenshots visually inspected; no clipping or horizontal overflow observed.
- [x] Update and visually review all four PDF slides with the client experience, configurable reply window and current test counts.
- [ ] Push this revision to the public repository.

No SMS, Square, Google Sheets or PostHog connection is implemented. The front desk performs the real calendar update manually. Authenticated staff see the offer list; clients see only the individual offer authorized by their personal link. These are assistant-run checks, not a claim that Lena or Edward performed a final review.

## Lena's requirements: current status

The offer flow, staff access and separate client offer page are implemented and tested. Historical evidence for earlier versions is retained below; the latest client-page verification appears first.

- [x] Match opted-in sample clients by service, availability and stylist preference; oldest eligible request first.
- [x] Offer to one client at a time per opening, wait for the staff-selected reply window (default 15 minutes), and automatically advance after decline or timeout.
- [x] Show exact service, stylist, date/time and response deadline, with clear accept and decline controls.
- [x] Reserve for the first valid acceptance; identify the holder and reject late or losing replies clearly.
- [x] Flag questions for staff follow-up without reserving the opening or extending its deadline.
- [x] Let staff cancel an offer and try the next person, or close an unavailable opening and stop.
- [x] Support simultaneous openings: earlier appointment first, then creation order; one active offer per client per service.
- [x] Let staff choose a practical cutoff for travel and service needs; stop offering when that cutoff is reached.
- [x] Keep Square as the real calendar and show the front-desk reminder after acceptance.
- [x] Clearly label every simulated message; send no real texts.
- [x] Restrict starting offers and viewing status to Lena and Carla through separate local staff accounts and server access checks.
- [x] Provide a separate client page for each personal offer, with appointment details, accept/decline choices and a question form.

## Client page verification

- [x] Client link works without a staff login and exposes only that offer. Tampered links and requests without a token are rejected.
- [x] Client question appears on the staff dashboard without reserving; client decline advances to the next eligible client.
- [x] Client acceptance confirms on the client page and identifies the same holder on the staff dashboard. A losing client's old link shows taken and cannot claim the slot.
- [x] Staff cancellation updates the client page and removes its response controls. Expiry, acceptance, follow-up, closure and competing-holder views are covered in unit tests.
- [x] `npm run typecheck` passes; all 26 automated tests and 14 browser/API check groups pass.
- [x] Refresh the presentation and instructions and visually inspect the client layouts.
- [ ] Push the client-page and configurable-response revision.

Browser verification uses separate staff and client contexts. The client has no staff cookie and cannot access `/api/salon`. The client replies through its own page; tests observe the result on the staff dashboard. Link signatures bind to one workflow run and offer. Client views exclude mobile numbers, other recipients, waitlist data and staff notes. No real messages were sent.

Consent and matching are demonstrated with seeded clients. The prototype does not implement Google Sheet intake/editing or a live opt-out channel. Lena described that existing process; the checklist does not claim it was replaced. Business results (fewer gaps and less staff checking) still need observation in a pilot.

## Access and final verification

- [x] Implement sign-in for Lena and Carla and enforce access on the server for staff data and actions.
- [x] Verify both staff accounts work; signed-out, invalid-account and direct API requests cannot access staff data or actions; signing out removes access.
- [x] Rerun the existing behavior and browser checks after the access change, preserving the simulated offer flow.
- [x] Update README, slides and this checklist to reflect the verified access behavior, then push the revision (prior access revision, commit `3b1a639`).

### Access evidence (October 7, 2026)

- `npm run typecheck` passed. `npm test` passed all 21 tests: the previous 14 tests plus seven access tests in `tests/auth.test.ts`.
- Signed-out requests to the dashboard redirect to sign-in. Requests to staff data, creating openings, starting offers, replying and cancelling return HTTP 401 without a valid session.
- Both allowed staff accounts authenticate. Wrong passwords, unknown accounts and forged/malformed cookies are rejected. Logout revokes the saved cookie, and sessions expire after eight hours.
- Cross-origin writes are blocked; repeated failed login attempts are throttled. Generated credentials persist as salted hashes; local login instructions are excluded from Git.
- `npm run test:browser` passed nine check groups. The browser signs in as Lena, completes the offer scenarios, signs out, confirms the old cookie no longer works, then signs in as Carla, sees the shared outcomes, adds an opening and closes it.
- Test credentials were generated in memory for the isolated browser API. No test password or real local credential is committed.

### Deferred by Edward

PostHog tracking is deferred until after this checklist. No PostHog integration or external analytics transmission has been added.

## Already confirmed

- [x] Capture Lena's needs and get her agreement.
- [x] Create the public repository from the starter without forking.
- [x] Start the website, API, worker, and Temporal locally.
- [x] Pass the basic offer-and-acceptance test.
- [x] Create the initial GenderMag review and three-slide PDF.

## Prior completed verification and evidence

- [x] **1. Cancellation:** Try next skips the cancelled person. Close opening stops further offers.
- [x] **2. Late replies:** Expired or taken offers give a clear response and cannot reserve the slot.
- [x] **3. Timeout:** After 15 minutes, the next eligible person receives the offer. Exhausting the list produces a clear status.
- [x] **4. Matching and priority:** Verify service, availability, stylist preference, opt-outs, oldest request, and opening order.
- [x] **5. Conflicting responses:** Verify one holder per opening and the agreed limits on simultaneous client offers.
- [x] **6. Questions:** An unclear reply flags staff follow-up without reserving the appointment.
- [x] **7. Recovery:** Restarting the worker preserves the pending offer and its original deadline.
- [x] **8. Browser walkthrough:** Exercise the visible controls in a real browser and check desktop/mobile layouts. Record assistant testing separately from Edward's own review.
- [x] **9. Repository deliverables:** Update the slides and instructions to match verified behavior, then push the final changes.

## Evidence for item 1

Verified on October 7, 2026 with `npm test` using Temporal's test server:

- Before the fix, the cancellation regression failed: the next offer went to Maya again, although Jordan was expected.
- After the fix, cancelling Maya's offer for a still-open weekday Haircut with Jules creates a new offer for Jordan. Maya's offer remains cancelled and its simulated message tells her the opening is unavailable.
- Cancelling Jordan's offer then leaves that opening unfilled with no active offer. Only the two eligible clients have been offered that opening.
- Closing an active opening cancels its offer and clears its active offer reference. After advancing Temporal's test clock 16 minutes and asking the queue to start again, the opening remains closed and no new offers exist.
- All three workflow tests pass, including the existing acceptance scenario. `npm run typecheck` passes.

## Evidence for items 2-7

`npm test`: 14 passing tests, zero failures (October 7, 2026). See `tests/behavior.test.ts` and `tests/workflow.test.ts` for reproducible assertions.

| Item | Observed behavior |
| --- | --- |
| 2 | Maya's expired acceptance returns `expired`; after Jordan accepts it returns `taken`. Jordan remains the sole holder. Missing and cancelled offers return clear simulated feedback. |
| 3 | At 14 minutes the original offer remains; at 15 minutes Jordan receives the next offer. Another 15 minutes exhausts the list with no active offer. |
| 4 | Tests cover service, weekday/weekend and afternoon availability, stylist preferences, oldest request, opt-outs, earlier appointment priority and creation order for equal appointment times. API normalization correctly treats Saturday 03:00 UTC as Friday evening in Pacific time. |
| 5 | Concurrent/repeated replies produce one accepted offer. A later decline or cancellation cannot overwrite it. Same-service offers do not overlap for one client; Sam may receive Color and Highlights independently. |
| 6 | A question marks staff follow-up, leaves the holder empty, and retains the original deadline. Timeout still advances to Jordan. |
| 7 | Worker 1 starts the offer and fully stops. Five minutes pass with no worker. Worker 2 replays the same offer and deadline; ten more minutes produce exactly one next offer. History replay also passes. Sticky caching is disabled in this isolated test so the test server routes queries to the replacement worker. |

Additional checks: a repeated cancellation for Maya cannot cancel Jordan's new offer; a staff cutoff shorter than 15 minutes closes active/unfilled openings; malformed and past API inputs are rejected.

The existing local session was also preserved during the code upgrade: saved history replay passed, and the before/after offers, openings and pending deadline were identical. No user demo records were reset.

## Evidence for item 8

`npm run test:browser`: seven groups of checks passed in headless Microsoft Edge against the real local Temporal server and worker. The script creates its own workflow and API on port 3001, then terminates only that test workflow.

- Load the dashboard and read simulation labels, sample waitlist and displayed time zone.
- Add a Haircut opening, start offers, ask a question, and observe follow-up without booking.
- Keep keyboard focus on a button through a polling refresh.
- Decline Maya, accept Jordan, try late and repeated acceptances; verify one holder and the Square reminder.
- Cancel a Highlights offer and exhaust its eligible list; close a Color opening and stop outreach.
- Inspect desktop (1440px) and mobile (390px) screenshots; no clipping or horizontal mobile overflow was observed.
- Reject invalid input with HTTP 400; no browser JavaScript errors occurred.

This is assistant-run browser verification. It is not a claim that Edward or Lena personally tested or signed off on the final build.

Local raw logs and screenshots are in ignored `.local/`; the reproducible test sources are included in the repository.

## Evidence for item 9

- README now includes native/Docker startup, automated and browser checks, a manual walkthrough, meaningful Temporal usage, and the exact prototype limits.
- The PDF contains four standalone 16:9 slides: customer problem, prototype behavior, checked behavior and exclusions, and a practical next step. All four pages were rendered and visually inspected. PDF metadata confirms four pages; Git stores the PDF without text conversion.
- The GenderMag-informed review records the final feedback, discoverability and keyboard-focus changes. It does not claim an empirical user study.
- Type checking passed. The final repeat of `npm test` passed all 14 tests with zero failures.
- Commit `15cdf21` with the prototype, tests, documentation and PDF was pushed successfully to `origin/main` on October 7, 2026. GitHub confirms `edCitalan/temporal-waitlist-assessment` is public and is not a fork.

The earlier prototype and presentation were pushed successfully. The latest revision's documentation/push status is recorded above. This checklist does not claim that Edward has delivered the presentation or submitted the repository link through the assessment portal.
