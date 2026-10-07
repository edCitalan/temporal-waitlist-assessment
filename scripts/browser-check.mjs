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
await mkdir(".local", { recursive: true });
const api = spawn(process.execPath, ["--import", "tsx", "src/api.ts"], {
  env: { ...process.env, PORT: String(port), SALON_WORKFLOW_ID: workflowId, TEMPORAL_ADDRESS: "127.0.0.1:7233" },
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
  await add("Haircut");
  await page.locator("#start-offers").click();
  await card("Maya Rivera").waitFor();
  await card("Maya Rivera").getByRole("button", { name: "Simulate a question" }).click();
  await page.getByText("Staff should follow up.", { exact: false }).waitFor();
  assert.match(await page.locator("#opening-list").innerText(), /no reservation yet/);
  const focusButton = card("Maya Rivera").getByRole("button", { name: "Simulate decline" });
  await focusButton.focus();
  await page.waitForTimeout(2200); // Cross one polling refresh and verify focus stays put.
  assert.equal(await focusButton.evaluate(el => el === document.activeElement), true);
  await page.screenshot({ path: ".local/browser-desktop.png", fullPage: true });
  checks.push("Question flags follow-up without booking; unchanged polling preserves keyboard focus.");
  await focusButton.click();
  await card("Jordan Lee").waitFor();
  const maya = page.locator(".offer-card.is-history").filter({ hasText: "Maya Rivera" });
  await maya.getByRole("button", { name: "Simulate late acceptance" }).click();
  await page.waitForFunction(() => document.querySelector("#reply-feedback").textContent.includes("no longer available"));
  await card("Jordan Lee").getByRole("button", { name: "Simulate clear" }).click();
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("Jordan Lee accepted"));
  await maya.getByRole("button", { name: "Simulate late acceptance" }).click();
  await page.waitForFunction(() => document.querySelector("#reply-feedback").textContent.includes("already taken"));
  await page.getByRole("button", { name: "Simulate repeated acceptance" }).click();
  const state = await (await fetch(`${base}/api/salon`)).json();
  assert.equal(state.offers.filter(o => o.status === "accepted").length, 1);
  assert.equal(state.openings[0].bookedClientId, "jordan-lee-haircut");
  checks.push("Decline advances; late reply is rejected; clear acceptance identifies Jordan and Square handoff; retries keep one holder.");

  await add("Highlights");
  await card("Sam Patel").waitFor();
  await card("Sam Patel").getByRole("button", { name: "Cancel offer" }).click();
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("No more opted-in clients"));
  checks.push("Cancel-and-try-next exhausts the single Highlights request without reoffering it.");
  await add("Color");
  await card("Sam Patel").waitFor();
  await card("Sam Patel").getByRole("button", { name: "Close opening", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#opening-list").textContent.includes("Opening closed"));
  checks.push("Close opening cancels the active offer and stops outreach.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/browser-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push("390px mobile layout has no horizontal overflow.");
  const bad = await fetch(`${base}/api/openings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: "Haircut", startsAt: "2000-01-01T00:00:00Z" }) });
  assert.equal(bad.status, 400);
  assert.equal(errors.length, 0, errors.join("\n"));
  checks.push("Malformed/past opening returns HTTP 400; no browser JavaScript errors.");
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
