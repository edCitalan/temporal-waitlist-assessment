import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import { createStaffAuth, hashPasswords, loadStaffCredentials } from "../src/auth";

const passwords = { lena: randomBytes(18).toString("hex"), carla: randomBytes(18).toString("hex") };
const credentials = hashPasswords(passwords);
async function withServer(run: (base: string, advance: (ms: number) => void) => Promise<void>) {
  let clock = Date.now();
  const auth = createStaffAuth(credentials, () => clock);
  const app = express();
  app.use(express.json());
  app.use("/api", auth.sameOrigin);
  app.post("/api/auth/login", auth.login);
  app.post("/api/auth/logout", auth.logout);
  app.use(auth.requireStaff);
  app.get("/api/salon", (_req, res) => res.json({ staff: res.locals.staff }));
  app.post(["/api/openings", "/api/offers/start", "/api/offers/one/reply", "/api/openings/one/cancel"], (_req, res) => res.json({ changed: true, staff: res.locals.staff }));
  app.get("/", (_req, res) => res.send("Private dashboard"));
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, ms => { clock += ms; }); }
  finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}
const post = (base: string, route: string, body: unknown, cookie = "", headers: Record<string, string> = {}) => fetch(base + route, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, ...headers }, body: JSON.stringify(body),
});
const login = (base: string, username: "lena" | "carla") => post(base, "/api/auth/login", { username, password: passwords[username] });
const cookieFrom = (response: Response) => response.headers.get("set-cookie")!.split(";")[0];

test("signed-out visitors cannot read staff data or call any staff action", async () => {
  await withServer(async base => {
    const page = await fetch(base, { redirect: "manual" });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/login");
    assert.equal((await fetch(base + "/api/salon")).status, 401);
    for (const route of ["/api/openings", "/api/offers/start", "/api/offers/one/reply", "/api/openings/one/cancel"]) {
      assert.equal((await post(base, route, {})).status, 401, route);
    }
    assert.equal((await fetch(base + "/api/salon", { headers: { Cookie: `juniper_session=${"A".repeat(43)}` } })).status, 401);
  });
});

test("Lena and Carla each authenticate and can use protected staff actions", async () => {
  await withServer(async base => {
    for (const username of ["lena", "carla"] as const) {
      const response = await login(base, username);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
      assert.match(response.headers.get("set-cookie")!, /SameSite=Strict/);
      const cookie = cookieFrom(response);
      const data = await fetch(base + "/api/salon", { headers: { Cookie: cookie } });
      assert.equal(data.headers.get("cache-control"), "no-store");
      assert.equal((await data.json()).staff, username);
      assert.equal((await post(base, "/api/offers/start", {}, cookie)).status, 200);
    }
  });
});

test("wrong passwords, unknown accounts and malformed cookies are rejected", async () => {
  await withServer(async base => {
    for (const body of [{ username: "lena", password: "wrong" }, { username: "other-staff", password: passwords.lena }, {}]) {
      const response = await post(base, "/api/auth/login", body);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal((await fetch(base + "/api/salon", { headers: { Cookie: "juniper_session=%XX" } })).status, 401);
  });
});

test("logout revokes the old cookie and sessions expire after eight hours", async () => {
  await withServer(async (base, advance) => {
    const cookie = cookieFrom(await login(base, "lena"));
    assert.equal((await post(base, "/api/auth/logout", {}, cookie)).status, 200);
    assert.equal((await fetch(base + "/api/salon", { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await post(base, "/api/offers/start", {}, cookie)).status, 401);
    const other = cookieFrom(await login(base, "carla"));
    advance(8 * 60 * 60 * 1000 + 1);
    assert.equal((await fetch(base + "/api/salon", { headers: { Cookie: other } })).status, 401);
  });
});

test("cross-origin login and staff mutations are blocked", async () => {
  await withServer(async base => {
    assert.equal((await post(base, "/api/auth/login", { username: "lena", password: passwords.lena }, "", { Origin: "https://example.invalid" })).status, 403);
    const cookie = cookieFrom(await login(base, "lena"));
    assert.equal((await post(base, "/api/offers/start", {}, cookie, { Origin: "https://example.invalid" })).status, 403);
    assert.equal((await post(base, "/api/offers/start", {}, cookie, { Origin: base })).status, 200);
  });
});

test("repeated failed logins are throttled and recover after a minute", async () => {
  await withServer(async (base, advance) => {
    for (let i = 0; i < 5; i++) assert.equal((await post(base, "/api/auth/login", { username: "lena", password: "wrong" })).status, 401);
    assert.equal((await login(base, "lena")).status, 429);
    advance(60001);
    assert.equal((await login(base, "lena")).status, 200);
  });
});

test("generated local accounts persist as salted hashes with separate login instructions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "juniper-auth-test-"));
  try {
    const first = loadStaffCredentials(directory);
    const second = loadStaffCredentials(directory);
    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(first).sort(), ["carla", "lena"]);
    const instructions = readFileSync(path.join(directory, "staff-login.txt"), "utf8");
    for (const name of ["lena", "carla"] as const) {
      assert.match(first[name].hash, /^[a-f0-9]{128}$/);
      assert.ok(!instructions.includes(first[name].hash));
    }
  } finally {
    // mkdtemp returns an absolute directory under the explicitly selected temp root.
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
