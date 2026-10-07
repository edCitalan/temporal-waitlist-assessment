// Requires the local Temporal server and worker (npm run dev:local).
// Uses an isolated workflow and API port; it never changes the user's demo data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { Client, Connection } from "@temporalio/client";

const workflowId = `browser-check-${randomUUID()}`;
const port = Number(process.env.BROWSER_TEST_PORT ?? 3001);
const base = `http://127.0.0.1:${port}`;
const checks = [];
const passwords = { lena: randomUUID(), carla: randomUUID() };
await mkdir(".local", { recursive: true });
const api = spawn(process.execPath, ["--import", "tsx", "src/api.ts"], {
  env: { ...process.env, PORT: String(port), SALON_WORKFLOW_ID: workflowId, TEMPORAL_ADDRESS: "127.0.0.1:7233", JUNIPER_LENA_PASSWORD: passwords.lena, JUNIPER_CARLA_PASSWORD: passwords.carla },
  windowsHide: true, stdio: "pipe",
});
let browser;
const errors = [];
api.stderr.on("data", chunk => errors.push(String(chunk)));
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready, `Test API did not start: ${errors.join("")}`);
  browser = await chromium.launch(process.platform === "win32" ? { channel: "msedge", headless: true } : { headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Staff sign-in" }).waitFor();
  assert.equal((await context.request.get(`${base}/api/salon`)).status(), 401);
  for (const route of ["/api/openings", "/api/offers/start", "/api/offers/missing/reply", "/api/openings/missing/cancel", "/api/simulation/advance", "/api/openings/missing/square"]) {
    assert.equal((await context.request.post(base + route, { data: {} })).status(), 401);
  }
  await page.locator('[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("The staff account or password is incorrect.", { exact: true }).waitFor();
  await page.screenshot({ path: ".local/browser-login.png", fullPage: true });
  await page.locator('[name="password"]').fill(passwords.lena);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Signed in as Lena", { exact: true }).waitFor();
  checks.push("Signed-out staff data/actions and wrong credentials are blocked; Lena signs in successfully.");
  await page.getByText("6 opted in", { exact: true }).waitFor();
  assert.match(await page.locator(".notice").innerText(), /No SMS is sent/);
  assert.match(await page.locator("#timezone-hint").innerText(), /America\/Los Angeles/);
  checks.push("Page loads; simulation label, sample waitlist and time zone visible.");

  const date = new Date(Date.now() + 7 * 86400000);
  date.setUTCDate(date.getUTCDate() + (4 - date.getUTCDay() + 7) % 7);
  const datePart = date.toISOString().slice(0, 10);
  async function add(service, stylist = "Jules", hour = "15:00") {
    await page.locator('[name="service"]').selectOption(service);
    await page.locator('[name="stylist"]').selectOption(stylist);
    await page.locator('[name="startsAt"]').fill(`${datePart}T${hour}`);
    await page.getByRole("button", { name: "Add opening to queue" }).click();
    await page.waitForFunction(() => document.querySelector("#form-feedback").textContent.startsWith("Opening added."));
  }
  const card = name => page.locator(".offer-card.is-active").filter({ has: page.locator(".offer-person strong", { hasText: name }) });
  await page.locator('[name="responseMinutes"]').fill("7");
  await add("Haircut");
  const queueStartedAt = Date.now();
  await page.locator("#start-offers").click();
  await card("Maya Rivera").waitFor();
  const clientContext = await browser.newContext({ viewport: { width: 430, height: 950 }, timezoneId: "America/Los_Angeles" });
  const mayaPage = await clientContext.newPage();
  mayaPage.on("pageerror", e => errors.push(e.message));
  const mayaLink = await card("Maya Rivera").getByRole("link", { name: "Open client offer page" }).getAttribute("href");
  const mayaToken = mayaLink.split("#")[1];
  await mayaPage.goto(base + mayaLink);
  await mayaPage.getByRole("button", { name: "Accept this appointment", exact: true }).waitFor();
  assert.match(await mayaPage.locator("#client-greeting").innerText(), /Maya Rivera/);
  assert.equal(await mayaPage.locator("#client-service").innerText(), "Haircut");
  assert.equal(await mayaPage.locator("#client-stylist").innerText(), "Jules");
  assert.equal((await clientContext.request.get(`${base}/api/salon`)).status(), 401);
  const clientData = await clientContext.request.get(`${base}/api/client/offer`, { headers: { Authorization: `Bearer ${mayaToken}` } });
  const ownOffer = await clientData.json();
  assert.equal(ownOffer.clientName, "Maya Rivera");
  const replyWindow = Date.parse(ownOffer.deadlineAt) - queueStartedAt;
  assert.ok(replyWindow >= 7 * 60000 && replyWindow < 7 * 60000 + 30000);
  const staffData = await (await context.request.get(`${base}/api/salon`)).json();
  assert.equal(staffData.openings[0].responseMinutes, 7);
  const originalInput = staffData.openings[0];
  const repeated = await context.request.post(`${base}/api/openings`, { data: originalInput });
  assert.equal(repeated.status(), 200);
  assert.equal((await repeated.json()).code, "duplicate");
  const duplicateSlot = await context.request.post(`${base}/api/openings`, { data: { ...originalInput, requestId: randomUUID() } });
  assert.equal(duplicateSlot.status(), 409);
  assert.equal((await (await context.request.get(`${base}/api/salon`)).json()).openings.length, 1);
  checks.push("Retrying an opening is idempotent; a second staff request for the same stylist/time is rejected without another offer.");
  checks.push("Staff chooses a 7-minute reply window; the workflow and separate client page show the matching deadline.");
  assert.ok(!JSON.stringify(ownOffer).includes("Jordan Lee"));
  assert.equal(ownOffer.waitlist, undefined);
  assert.equal((await clientContext.request.get(`${base}/api/client/offer`, { headers: { Authorization: `Bearer ${mayaToken}x` } })).status(), 401);
  assert.equal((await clientContext.request.post(`${base}/api/client/offer/reply`, { data: { kind: "accept" } })).status(), 401);
  await mayaPage.screenshot({ path: ".local/client-offer-mobile.png", fullPage: true });
  assert.equal(await mayaPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push("Separate client link works without staff login, shows exact details and exposes only that offer; invalid links cannot read or reply.");
  await mayaPage.locator("#client-question").fill("Can I keep the same haircut length?");
  await mayaPage.getByRole("button", { name: "Send question to staff" }).click();
  await mayaPage.waitForFunction(() => document.querySelector("#client-status").dataset.status === "needs-follow-up");
  await page.getByText("Staff should follow up.", { exact: false }).waitFor();
  assert.match(await card("Maya Rivera").innerText(), /Can I keep the same haircut length/);
  assert.match(await page.locator("#opening-list").innerText(), /no reservation yet/);
  const focusButton = card("Maya Rivera").getByRole("button", { name: "Simulate decline" });
  await focusButton.focus();
  await page.waitForTimeout(2200); // Cross one polling refresh and verify focus stays put.
  assert.equal(await focusButton.evaluate(el => el === document.activeElement), true);
  await page.screenshot({ path: ".local/browser-desktop.png", fullPage: true });
  checks.push("Question flags follow-up without booking; unchanged polling preserves keyboard focus.");
  await mayaPage.getByRole("button", { name: "Decline", exact: true }).click();
  await mayaPage.waitForFunction(() => document.querySelector("#client-status").dataset.status === "declined");
  await card("Jordan Lee").waitFor();
  const jordanPage = await clientContext.newPage();
  const jordanLink = await card("Jordan Lee").getByRole("link", { name: "Open client offer page" }).getAttribute("href");
  await jordanPage.goto(base + jordanLink);
  await jordanPage.getByRole("button", { name: "Accept this appointment", exact: true }).waitFor();
  checks.push("Client question appears on staff dashboard without booking; client decline advances to Jordan's separate offer.");
  const maya = page.locator(".offer-card.is-history").filter({ hasText: "Maya Rivera" });
  await maya.getByRole("button", { name: "Simulate late acceptance" }).click();
  await page.waitForFunction(() => document.querySelector("#reply-feedback").textContent.includes("no longer available"));
  await jordanPage.getByRole("button", { name: "Accept this appointment", exact: true }).click();
  await jordanPage.waitForFunction(() => document.querySelector("#client-status").dataset.status === "accepted");
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("Jordan Lee accepted"));
  await maya.getByRole("button", { name: "Simulate late acceptance" }).click();
  await page.waitForFunction(() => document.querySelector("#reply-feedback").textContent.includes("already taken"));
  await mayaPage.waitForFunction(() => document.querySelector("#client-status").dataset.status === "taken");
  assert.equal(await mayaPage.locator("#client-actions").isVisible(), false);
  const losing = await clientContext.request.post(`${base}/api/client/offer/reply`, { headers: { Authorization: `Bearer ${mayaToken}` }, data: { kind: "accept", offerId: jordanLink.split("#")[1] } });
  assert.equal((await losing.json()).code, "taken");
  await jordanPage.setViewportSize({ width: 1100, height: 1100 });
  await jordanPage.screenshot({ path: ".local/client-offer-accepted.png", fullPage: true });
  checks.push("Client acceptance confirms in its own page and staff dashboard; a losing client sees taken and cannot claim another offer.");
  await page.getByRole("button", { name: "Simulate repeated acceptance" }).click();
  const state = await (await context.request.get(`${base}/api/salon`)).json();
  assert.equal(state.offers.filter(o => o.status === "accepted").length, 1);
  assert.equal(state.openings[0].bookedClientId, "jordan-lee-haircut");
  checks.push("Decline advances; late reply is rejected; clear acceptance identifies Jordan and Square handoff; retries keep one holder.");

  const detail = await context.newPage();
  detail.on("pageerror", e => errors.push(e.message));
  await detail.goto(base + "/openings/" + state.openings[0].id);
  const detailPanel = detail.locator("#opening-detail");
  await detailPanel.getByText("Who holds it: Jordan Lee", { exact: true }).waitFor();
  assert.match(await detailPanel.innerText(), /Can I keep the same haircut length/);
  assert.match(await detailPanel.innerText(), /Sent:.*Deadline:/);
  await detailPanel.getByRole("button", { name: "Mark manual Square update done", exact: true }).click();
  await detailPanel.getByRole("button", { name: "Reopen Square checklist", exact: true }).waitFor();
  await detail.reload();
  await detailPanel.getByText("Marked done by lena", { exact: false }).waitFor();
  await detail.setViewportSize({ width: 1100, height: 950 });
  await detail.evaluate(() => window.scrollTo(0, document.querySelector("#opening-detail").offsetTop - 16));
  await detail.screenshot({ path: ".local/opening-detail-desktop.png" });
  await detail.setViewportSize({ width: 390, height: 844 });
  await detail.evaluate(() => window.scrollTo(0, document.querySelector("#opening-detail").offsetTop - 16));
  assert.equal(await detail.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await detail.screenshot({ path: ".local/opening-detail-mobile.png" });
  await detailPanel.getByRole("button", { name: "Reopen Square checklist", exact: true }).click();
  await detailPanel.getByRole("button", { name: "Mark manual Square update done", exact: true }).waitFor();
  await detail.close();
  checks.push("Opening detail preserves the full message timeline, holder and offer timestamps; manual Square checklist survives reload and can be reopened.");

  await add("Highlights", "Jules", "16:00");
  await card("Sam Patel").waitFor();
  const samPage = await clientContext.newPage();
  await samPage.goto(base + await card("Sam Patel").getByRole("link", { name: "Open client offer page" }).getAttribute("href"));
  await samPage.getByRole("button", { name: "Accept this appointment", exact: true }).waitFor();
  await card("Sam Patel").getByRole("button", { name: "Cancel offer" }).click();
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("No more opted-in clients"));
  await samPage.waitForFunction(() => document.querySelector("#client-status").dataset.status === "unavailable");
  assert.equal(await samPage.locator("#client-actions").isVisible(), false);
  checks.push("Staff cancellation updates the separate client page and removes acceptance controls.");
  checks.push("Cancel-and-try-next exhausts the single Highlights request without reoffering it.");
  await add("Color", "Jules", "17:00");
  await card("Sam Patel").waitFor();
  await card("Sam Patel").getByRole("button", { name: "Close opening", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("Opening closed"));
  checks.push("Close opening cancels the active offer and stops outreach.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/browser-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push("390px mobile layout has no horizontal overflow.");
  const bad = await context.request.post(`${base}/api/openings`, { data: { service: "Haircut", startsAt: "2000-01-01T00:00:00Z" } });
  assert.equal(bad.status(), 400);
  assert.equal(errors.length, 0, errors.join("\n"));
  checks.push("Malformed/past opening returns HTTP 400; no browser JavaScript errors.");
  const oldCookie = (await context.cookies()).find(c => c.name === "juniper_session");
  assert.ok(oldCookie?.httpOnly);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Staff sign-in" }).waitFor();
  assert.equal((await context.request.get(`${base}/api/salon`)).status(), 401);
  const stale = await fetch(`${base}/api/salon`, { headers: { Cookie: `juniper_session=${oldCookie.value}` } });
  assert.equal(stale.status, 401);
  await page.locator('[name="username"]').selectOption("carla");
  await page.locator('[name="password"]').fill(passwords.carla);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Signed in as Carla", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("Jordan Lee accepted"));
  await add("Haircut", "Rosa");
  await card("Maya Rivera").waitFor();
  await card("Maya Rivera").getByRole("button", { name: "Close opening", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#active-count").textContent === "0 active");
  checks.push("Logout revokes the old session; Carla signs in, sees shared outcomes, adds and closes an opening.");
  await page.locator('[name="responseMinutes"]').fill("15");
  await add("Haircut", "Rosa", "16:00");
  await card("Maya Rivera").waitFor();
  const timeoutPage = await clientContext.newPage();
  await timeoutPage.goto(base + await card("Maya Rivera").getByRole("link", { name: "Open client offer page" }).getAttribute("href"));
  await timeoutPage.getByRole("button", { name: "Accept this appointment", exact: true }).waitFor();
  await page.getByRole("button", { name: "Fast-forward 15 minutes", exact: true }).click();
  await page.getByText("Simulation advanced 15 minutes.", { exact: false }).waitFor();
  await timeoutPage.waitForFunction(() => document.querySelector("#client-status").dataset.status === "expired");
  assert.equal(await timeoutPage.locator("#client-actions").isVisible(), false);
  const advanced = await (await context.request.get(`${base}/api/salon`)).json();
  assert.equal(advanced.clockOffsetMs, 15 * 60000);
  assert.equal(advanced.offers.at(-1).status, "expired");
  assert.match(await page.locator("#message-inbox").innerText(), /reply window ended/);
  checks.push("Fast-forward button expires an unanswered offer, records its timeline and disables acceptance on the client page.");
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(".local/browser-check-results.json", JSON.stringify({ checkedAt: new Date().toISOString(), workflowId, checks }, null, 2));
  console.log(`PASS: ${checks.length} browser/API checks\n${checks.join("\n")}`);
} finally {
  await browser?.close();
  api.kill();
  const connection = await Connection.connect({ address: "127.0.0.1:7233" });
  try { await new Client({ connection }).workflow.getHandle(workflowId).terminate("Isolated browser checks finished"); }
  catch (error) { if (error.name !== "WorkflowNotFoundError") throw error; }
  finally { await connection.close(); }
}
