# Juniper Salon earlier-appointment offers

A local prototype for managing cancellations at Juniper Salon. Staff add one or more openings, then Temporal offers each opening to the oldest eligible opted-in client, one client at a time. A clear acceptance reserves the opening in this prototype; front-desk staff still update Square.

## Run locally

Requirements: Node.js 20 or newer and Docker Desktop.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The local Temporal Web UI is at <http://localhost:8233>. Stop the app with `Ctrl+C`; stop the Temporal container with `npm run stop`.

Useful checks:

```bash
npm run typecheck
npm test
```

The Temporal test environment downloads its test server the first time it runs, so network access may be needed.

## Prototype behavior

- Matches service, availability, and stylist preference; opted-out clients are excluded.
- Orders openings by appointment time, then creation time. Within each opening, the oldest matching waitlist request gets the first offer.
- Sends one simulated offer at a time for an opening, with a 15-minute durable Temporal wait. Declines and timeouts move to the next eligible client.
- Simulated accept, decline, question, and staff-cancellation controls let evaluators demonstrate the flow locally.
- A question requests staff follow-up and does not reserve the opening. A clear acceptance marks the opening booked and identifies the client.
- Each client can have at most one active offer per service. Separate service requests can be offered independently.
- Every simulated message is labeled. No SMS is sent, and Square is not connected.

The sample waitlist is seeded in `src/workflows.ts`. Availability matching uses the sample's simple time categories; travel time and service practicality remain staff judgment, as Lena requested.

## Project map

- `output/presentation/juniper-salon-prototype.pdf` — three standalone slides for Lena
- `src/workflows.ts` — durable offer queue, timeout, matching, replies, and cancellation behavior
- `src/api.ts` — local API and Temporal client
- `src/worker.ts` — Temporal worker
- `src/types.ts` — shared data types
- `public/` — staff dashboard and simulated client actions
- `tests/workflow.test.ts` — workflow test
- `docs/gendermag-walkthrough.md` — task-based usability review

## References used

- [Temporal TypeScript developer guide](https://docs.temporal.io/develop/typescript) and [Workflow message passing](https://docs.temporal.io/encyclopedia/workflow-message-passing) informed the durable wait and signal/query design.
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) informed the shared typed data model.
- [GenderMag](https://gendermag.org/gendermag.php) informed a task-based usability review: clear next steps, visible status, explicit response choices, and a visible consequence for each action.
