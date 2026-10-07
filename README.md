# Juniper Salon earlier-appointment offers

A local prototype with two separate experiences: a protected dashboard for Lena and Carla, and a personal offer page for each client. Staff add openings, then Temporal offers each opening to the oldest eligible opted-in client, one client at a time. Clients accept, decline or ask a question on their own page. A clear acceptance reserves the opening in this prototype; front-desk staff still update Square.

## Run locally

Requirements: Node.js 20 or newer with npm, plus internet access on first run to download dependencies and the Temporal CLI. From the repository directory, run this single command (Windows PowerShell, macOS or Linux):

```bash
npm start
```

This installs missing locked dependencies automatically and starts the native Temporal server, Worker and API together. Docker is not required. Open [the local dashboard](http://localhost:3000). The [local Temporal Web UI](http://localhost:8233) shows the durable workflow and timer history. Stop the native app with `Ctrl+C`. Keep this assessment local; do not deploy it publicly.

## Submission items

- [Public repository](https://github.com/edCitalan/temporal-waitlist-assessment), created outside GitHub's fork network.
- One-command startup: `npm start`, as described above.
- [Temporal Web UI screenshots](evidence/README.md), including workflow identity and durable timer/event history.
- [Four-slide PDF presentation](output/presentation/juniper-salon-prototype.pdf).
- [Verification checklist](docs/verification-checklist.md), including checked behavior and prototype limits.

### Additional startup options

For an already-installed checkout, `npm run dev:local` remains available. Run `npm ci` manually after changing dependency versions. The optional Docker path below requires dependencies installed first.

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

The Temporal test environment downloads its test server on first use. `npm test` starts isolated test servers and advances their clocks, so waits run quickly. The suite has 37 tests: seven staff access checks, five client-link/view checks, 15 original offer-flow/validation/recovery checks, and ten deeper audit checks. Response windows of 5, 15 and 30 minutes, duplicate submissions, simulated time across worker restart, and acceptance racing with cancellation are covered.

For `npm run test:browser`, first leave `npm run dev:local` running in another terminal. Browser checks use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` once. The script uses port 3001, temporary in-memory test passwords and an isolated workflow, exercises the visible controls, saves local screenshots, and terminates its test workflow. Seventeen browser/API check groups cover staff/client pages, a seven-minute window, duplicate submissions, the opening detail and message timeline, the manual Square checklist, and fast-forwarded expiry. The user's demo data and passwords are untouched.

### Separate client offer page

Every staff offer card has **Open client offer page**. This is the personal link that a future SMS integration would deliver; no SMS is sent in the prototype. It opens `/offer#...` in a new tab, with the client's service, stylist, appointment, duration and response deadline. The client can accept, decline or type a question without a staff account. The dashboard reflects the response. Cancelled, expired and taken offers show an explanation and remove response controls.

The signed link is access to one specific offer and workflow run. The client API ignores any caller-supplied offer ID and exposes no waitlist, other recipients, mobile numbers or staff notes. Tokens travel in an authorization header from the URL fragment. The signing secret persists in ignored `.local/client-link-secret.txt` so API restarts preserve links. Treat these personal links like private invitations; do not post them in the public repository. Staff-only simulation buttons remain available as evaluation shortcuts.

## Prototype behavior

- Matches service, availability, and stylist preference; opted-out clients are excluded.
- Orders openings by appointment time, then creation time. Within each opening, the oldest matching waitlist request gets the first offer.
- Staff choose each opening's reply window in whole minutes (default 15). Each client receives that window, bounded by the visible practical cutoff. Temporal keeps the deadline durably; declines and timeouts move to the next eligible client.
- Clients have their own offer page with accept, decline and question controls. Staff have cancellation/status controls and additional simulation shortcuts for local evaluation.
- A question requests staff follow-up and does not reserve the opening. A clear acceptance marks the opening booked and identifies the client.
- Each client can have at most one active offer per service. Separate service requests can be offered independently.
- New opening submissions have retry IDs. Repeating a request returns the existing opening; another non-closed opening for the same stylist and exact start time is rejected atomically, including if the first is booked.
- Late replies receive an explicit expired, taken, or unavailable outcome. Repeated acceptance keeps the same holder; retrying an old cancellation cannot cancel the next person's offer.
- Staff may cancel and try the next client, or close the opening. An optional last practical response time shortens the reply window and stops outreach; otherwise the appointment start is the cutoff.
- Every simulated message is labeled. No SMS is sent; neither Square nor Google Sheets is connected.
- **View details and timeline** opens a staff-only page showing the holder, current offer, all offers, and timestamped messages. Earlier messages remain visible after a question or later reply. Newly created offers record send, deadline and response times; imported history without those fields is labeled as such.
- The **Update Square manually** checklist shows client, service, stylist, appointment and duration. Marking it done records the signed-in staff member and time in this prototype; it never calls Square. Staff can reopen the checklist.
- **Fast-forward 15 minutes** advances the whole salon's simulated clock. Every intervening reply deadline and practical cutoff is processed in order, including shorter reply windows. The clock offset is durable across restart; new openings must be after the displayed simulation time.

The sample waitlist is seeded in `src/legacy-workflow.ts` and shared by the new workflow. Availability uses simple categories in the time zone displayed beside the form (the browser's time zone). The API derives local calendar fields; it does not trust browser-supplied match fields. Travel time and service practicality remain staff judgment, expressed through the cutoff.

## What Temporal does

A salon workflow serializes opening, reply and cancellation decisions. Synchronous Workflow Updates create openings with duplicate protection, process replies, advance the simulated clock and record the manual Square checklist. Signals start offers and cancel them; a Query reads the dashboard snapshot. The first valid acceptance changes state before another reply can claim it. One durable timer watches the next reply deadline or staff cutoff. Absolute deadlines and simulated-clock offsets survive worker restart without restarting the reply window. No real-world message activity runs because all messages are simulated. The older create-opening signal remains for replay compatibility.

`src/legacy-workflow.ts` retains replay compatibility for the earlier local prototype. Its `upgradePrototype` signal continues as a new run with the same snapshot and original deadlines. The existing assessment session was migrated and checked without clearing records. Fresh checkouts start the current workflow automatically.

## Prototype limits

- **Local staff accounts:** password authentication and server access checks are implemented for Lena and Carla. This prototype has no password-recovery service, multi-factor authentication or managed identity provider. The API binds to loopback for local evaluation. The separate Temporal development UI is a local evaluator tool, not the staff website.
- **No real messaging or calendar integration:** offer links are opened manually from the staff demo; every message is simulated and staff manually update Square.
- **Sample data:** no waitlist intake/editing, real opt-out flow or contact-frequency policy. Opted-out seed entries are excluded from matching. Mobile number identifies the same sample client across requested services.
- **Prototype scale:** one persistent salon workflow; no history rotation or production monitoring. Duplicate protection covers request retries and the same stylist/exact start. Staff still judge real schedule conflicts, service duration, and travel practicality against Square; this is not a complete calendar conflict engine.
- Tests demonstrate the listed scenarios, not production readiness or a completed staff usability study.

## Quick manual walkthrough

Sign in as Lena or Carla using the local credentials described above.

1. Add a future weekday Haircut with Jules at 3 PM. Choose the reply window (15 minutes by default), leaving enough time before the practical cutoff. Start the queue if it is not already running.
2. On a fresh sample session, Maya receives the first offer. Click **Open client offer page**. Send a question there and observe staff follow-up on the dashboard, without booking. Click **Decline** on Maya's page; the staff dashboard advances to Jordan.
3. Open Jordan's client link and click **Accept this appointment**. Jordan's page confirms and the staff dashboard identifies Jordan. Maya's old link shows taken. Open **View details and timeline** to see both offers and the original question. Review **Update Square manually**, mark it done, then reload to verify the checklist remains done. Reopen it if needed; no Square connection occurs.
4. Add a weekday-afternoon Highlights opening at a different time. Cancel Sam's offer and try next; the list is exhausted. Use a Color opening at another time to demonstrate “Close opening.”
5. Add a weekday Haircut with Rosa at a new time, with a 15-minute reply window. Leave Maya's offer unanswered, then click **Fast-forward 15 minutes**. The offer expires; if another client matches, the queue advances automatically. Rosa has no other opted-in weekday Haircut match in this seed, so the opening becomes unfilled. Its client page no longer allows acceptance.
6. Try adding an existing non-closed opening's stylist and exact start again: the form rejects the duplicate. All simulated messages remain in the dashboard timeline and the individual opening's detail page.

The simulation clock applies to all openings, continues with real elapsed time and cannot be rewound. Restarting preserves it and the existing records. For a fresh clock and seed, use an independent session as described below.

For an independent empty demonstration session, stop the app and set a new `SALON_WORKFLOW_ID` environment variable before starting it again. Existing workflow history remains in Temporal. The automated browser script does this isolation itself.

If the site cannot be reached, keep the development terminal running, check its startup output, and use the native option when Docker is unavailable. See [verification checklist](docs/verification-checklist.md) for expected results and evidence.

## Assumptions used

- The seed contains six fictional people with fake `(555) 010-24xx` contacts and seven service requests; Sam separately requested Color and Highlights. A normalized mobile identifies the person across requests.
- Reply windows are whole minutes from 1 to 1440 for this prototype, defaulting to Lena's suggested 15. Staff can choose an earlier practical cutoff; otherwise outreach stops at appointment start. There is no fixed travel-time buffer.
- A question keeps the current offer open without a reservation until its original deadline, unless staff cancel it sooner. It does not extend the deadline.
- Priority applies to openings awaiting dispatch. Starting the queue after adding simultaneous openings demonstrates earlier appointment time, then creation order. Already-issued offers are not withdrawn when staff add another opening.
- A fulfilled request is excluded from later offers for that same service. Other separately requested services remain eligible. A client with a cancelled or expired offer cannot win with a stale reply.

## Project map

- `output/presentation/juniper-salon-prototype.pdf` — four standalone slides for Lena
- `evidence/` — Temporal Web UI screenshot and explanation of the observed workflow
- `scripts/start.mjs` — one-command dependency setup and native app startup
- `src/workflows.ts` — durable offer queue, timeout, matching, replies, and cancellation behavior
- `src/api.ts` — local API and Temporal client
- `src/auth.ts` — local staff credentials, sessions and server access checks
- `src/client-offer.ts` — signed personal offer links and the limited client data view
- `src/worker.ts` — Temporal worker
- `src/types.ts` — shared data types
- `public/` — staff dashboard/sign-in and separate client offer page
- `tests/` — behavior, validation, restart and replay tests
- `scripts/browser-check.mjs` — isolated browser walkthrough
- `scripts/build-slides.py` — reproducible PDF builder (optional Python + ReportLab)
- `docs/gendermag-walkthrough.md` — task-based usability review
- `docs/verification-checklist.md` — ordered checklist and evidence for completed checks

## References used

- [Temporal TypeScript developer guide](https://docs.temporal.io/develop/typescript) and [Workflow message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing) informed the durable wait and signal/query/update design.
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) informed the shared typed data model.
- [GenderMag](https://gendermag.org/gendermag.php) informed a task-based usability review: clear next steps, visible status, explicit response choices, and a visible consequence for each action.
- [Brandur's idempotency article](https://brandur.org/idempotency-keys) informed opening retry IDs and repeat-response guards. This prototype keeps decisions in Temporal and does not implement the article's Postgres architecture.

PostHog tracking is deferred at Edward's request and has not been added to the application.
