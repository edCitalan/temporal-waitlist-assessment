# Juniper Salon earlier-appointment offers

A local prototype for managing cancellations at Juniper Salon. Staff add one or more openings, then Temporal offers each opening to the oldest eligible opted-in client, one client at a time. A clear acceptance reserves the opening in this prototype; front-desk staff still update Square.

## Run locally

Requirements: Node.js 20 or newer. Use the native server below, or Docker Desktop for the Docker option. Keep this assessment local; do not deploy it publicly.

```bash
npm ci
npm run dev:local
```

Open [the local dashboard](http://localhost:3000). The [local Temporal Web UI](http://localhost:8233) shows the durable workflow and timer history. Stop the native app with `Ctrl+C`.

### Staff sign-in

On first launch, the API creates separate local accounts for **Lena** and **Carla**. Open `.local/staff-login.txt` on this computer for the generated passwords, then choose the account on the sign-in page. There is no public signup or shared default password. The login file and salted password hashes in `.local/staff-credentials.json` are excluded from Git; fresh checkouts generate their own credentials.

The server protects the dashboard, staff data and all offer actions. Sign out using the control beside your name. Sessions expire after eight hours and are cleared when the API restarts; appointment history stays in Temporal. Keep the generated passwords with the intended staff members. For automated evaluation, both passwords can instead be supplied through `JUNIPER_LENA_PASSWORD` and `JUNIPER_CARLA_PASSWORD` environment variables (at least 12 characters each).

Alternatively, with Docker Desktop running:

```bash
npm run dev
```

Both options start a real Temporal dev server, worker, API, and Temporal UI at the same addresses. The native option downloads the Temporal CLI on first use and persists history in ignored `.local/temporal.db`. For Docker, use `Ctrl+C` to stop the app and `npm run stop` to stop the Temporal container. Use one startup method at a time.

The workflow compiler dependency is pinned to `@swc/core` 1.15.11 because the newer native carrier could not load under this Windows machine's cache permissions. Both startup methods launch Node directly so they work without Unix-specific `npm` subprocess handling.

Useful checks:

```bash
npm run typecheck
npm test
npm run test:browser
```

The Temporal test environment downloads its test server on first use. `npm test` starts isolated test servers and advances their clocks, so the 15-minute waits run quickly. The final suite has 21 passing tests: seven access checks plus the 14 offer-flow, validation, restart and replay checks.

For `npm run test:browser`, first leave `npm run dev:local` running in another terminal. Browser checks use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` once. The script uses port 3001, temporary in-memory test passwords and an isolated workflow, exercises the visible controls, saves local screenshots, and terminates its test workflow. Nine browser/API check groups pass, including both staff accounts and logout; the user's demo data and passwords are untouched.

## Prototype behavior

- Matches service, availability, and stylist preference; opted-out clients are excluded.
- Orders openings by appointment time, then creation time. Within each opening, the oldest matching waitlist request gets the first offer.
- Creates one simulated offer at a time for an opening, with a durable Temporal wait of up to 15 minutes. Declines and timeouts move to the next eligible client.
- Simulated accept, decline, question, and staff-cancellation controls let evaluators demonstrate the flow locally.
- A question requests staff follow-up and does not reserve the opening. A clear acceptance marks the opening booked and identifies the client.
- Each client can have at most one active offer per service. Separate service requests can be offered independently.
- Late replies receive an explicit expired, taken, or unavailable outcome. Repeated acceptance keeps the same holder; retrying an old cancellation cannot cancel the next person's offer.
- Staff may cancel and try the next client, or close the opening. An optional last practical response time shortens the reply window and stops outreach; otherwise the appointment start is the cutoff.
- Every simulated message is labeled. No SMS is sent, and Square is not connected.

The sample waitlist is seeded in `src/legacy-workflow.ts` and shared by the new workflow. Availability uses simple categories in the time zone displayed beside the form (the browser's time zone). The API derives local calendar fields; it does not trust browser-supplied match fields. Travel time and service practicality remain staff judgment, expressed through the cutoff.

## What Temporal does

A salon workflow serializes opening, reply and cancellation decisions. Signals add openings and cancel offers; a synchronous Workflow Update processes a reply and returns its outcome; a Query reads the dashboard snapshot. The first valid acceptance changes state before another reply can claim it. One durable timer watches the next reply deadline or staff cutoff. Absolute deadlines survive worker restart rather than starting a new 15-minute window. No real-world message activity runs because all messages are simulated.

`src/legacy-workflow.ts` retains replay compatibility for the earlier local prototype. Its `upgradePrototype` signal continues as a new run with the same snapshot and original deadlines. The existing assessment session was migrated and checked without clearing records. Fresh checkouts start the current workflow automatically.

## Prototype limits

- **Local staff accounts:** password authentication and server access checks are implemented for Lena and Carla. This prototype has no password-recovery service, multi-factor authentication or managed identity provider. The API binds to loopback for local evaluation. The separate Temporal development UI is a local evaluator tool, not the staff website.
- **No real messaging or calendar integration:** every message is simulated; staff manually update Square.
- **Sample data:** no waitlist intake/editing, real opt-out flow or contact-frequency policy. Opted-out seed entries are excluded from matching. Mobile number identifies the same sample client across requested services.
- **Prototype scale:** one persistent salon workflow; no history rotation or production monitoring. Creating an opening is not deduplicated across lost HTTP responses, so staff should inspect the opening list before retrying an uncertain creation.
- Tests demonstrate the listed scenarios, not production readiness or a completed staff usability study.

## Quick manual walkthrough

Sign in as Lena or Carla using the local credentials described above.

1. Add a future weekday Haircut with Jules at 3 PM. Leave enough time before the practical cutoff. Start the queue if it is not already running.
2. On a fresh sample session, Maya receives the first offer. “Simulate a question” flags staff follow-up without booking. “Simulate decline” advances to Jordan.
3. Accept Jordan's offer. The opening identifies Jordan and reminds the front desk to update Square. Try Maya's late acceptance; the message says the appointment was taken.
4. Add a weekday-afternoon Highlights opening. Cancel Sam's offer and try next; the list is exhausted. Use another Color opening to demonstrate “Close opening.”
5. Observe a 15-minute timeout, or use `npm test` for the accelerated clock proof. Restarting the app retains earlier records; it does not reset the demo.

For an independent empty demonstration session, stop the app and set a new `SALON_WORKFLOW_ID` environment variable before starting it again. Existing workflow history remains in Temporal. The automated browser script does this isolation itself.

If the site cannot be reached, keep the development terminal running, check its startup output, and use the native option when Docker is unavailable. See [verification checklist](docs/verification-checklist.md) for expected results and evidence.

## Project map

- `output/presentation/juniper-salon-prototype.pdf` — four standalone slides for Lena
- `src/workflows.ts` — durable offer queue, timeout, matching, replies, and cancellation behavior
- `src/api.ts` — local API and Temporal client
- `src/auth.ts` — local staff credentials, sessions and server access checks
- `src/worker.ts` — Temporal worker
- `src/types.ts` — shared data types
- `public/` — staff dashboard and simulated client actions
- `tests/` — behavior, validation, restart and replay tests
- `scripts/browser-check.mjs` — isolated browser walkthrough
- `scripts/build-slides.py` — reproducible PDF builder (optional Python + ReportLab)
- `docs/gendermag-walkthrough.md` — task-based usability review
- `docs/verification-checklist.md` — ordered checklist and evidence for completed checks

## References used

- [Temporal TypeScript developer guide](https://docs.temporal.io/develop/typescript) and [Workflow message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing) informed the durable wait and signal/query/update design.
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) informed the shared typed data model.
- [GenderMag](https://gendermag.org/gendermag.php) informed a task-based usability review: clear next steps, visible status, explicit response choices, and a visible consequence for each action.
- [Brandur's idempotency article](https://brandur.org/idempotency-keys) informed repeat-response guards and the future need for provider idempotency when adding real SMS. This prototype does not implement that article's Postgres architecture.

PostHog tracking is deferred at Edward's request and has not been added to the application.
