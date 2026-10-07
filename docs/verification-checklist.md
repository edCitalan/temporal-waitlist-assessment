# Juniper prototype verification checklist

Only mark an item complete after its stated behavior is observed. Edward authorized completing the whole list with behavior tests and checkpoint updates on October 7, 2026.

## Already confirmed

- [x] Capture Lena's needs and get her agreement.
- [x] Create the public repository from the starter without forking.
- [x] Start the website, API, worker, and Temporal locally.
- [x] Pass the basic offer-and-acceptance test.
- [x] Create the initial GenderMag review and three-slide PDF.

## Completed verification, in order

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

Repository preparation is complete. This checklist does not claim that Edward has delivered the presentation or submitted the repository link through the assessment portal.
