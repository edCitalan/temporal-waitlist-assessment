import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Request, RequestHandler } from "express";

export type StaffName = "lena" | "carla";
export type Credentials = Record<StaffName, { salt: string; hash: string }>;
const names: StaffName[] = ["lena", "carla"];
const COOKIE = "juniper_session";
const SESSION_MS = 8 * 60 * 60 * 1000;

export function hashPasswords(passwords: Record<StaffName, string>): Credentials {
  return Object.fromEntries(names.map(name => {
    if (passwords[name].length < 12) throw new Error("Staff passwords must contain at least 12 characters.");
    const salt = randomBytes(16).toString("hex");
    return [name, { salt, hash: scryptSync(passwords[name], salt, 64).toString("hex") }];
  })) as Credentials;
}

export function loadStaffCredentials(directory = path.resolve(".local")): Credentials {
  const lena = process.env.JUNIPER_LENA_PASSWORD;
  const carla = process.env.JUNIPER_CARLA_PASSWORD;
  if (lena || carla) {
    if (!lena || !carla) throw new Error("Set both JUNIPER_LENA_PASSWORD and JUNIPER_CARLA_PASSWORD.");
    return hashPasswords({ lena, carla });
  }
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "staff-credentials.json");
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Credentials;
    if (!names.every(name => /^[a-f0-9]{32}$/.test(saved[name]?.salt ?? "") && /^[a-f0-9]{128}$/.test(saved[name]?.hash ?? ""))) {
      throw new Error("The local staff credential file is invalid. Restore it or set both staff password environment variables.");
    }
    return saved;
  }
  const passwords = { lena: randomBytes(18).toString("base64url"), carla: randomBytes(18).toString("base64url") };
  const credentials = hashPasswords(passwords);
  const instructions = [
    "Juniper Salon - local prototype sign-in", "", "Open http://localhost:3000/", "",
    `Lena: username lena | password ${passwords.lena}`,
    `Carla: username carla | password ${passwords.carla}`, "",
    "These local credentials are excluded from Git. Keep this file on your computer.",
    "Sessions expire after eight hours. Restarting the API signs everyone out without resetting appointments.", "",
  ].join("\n");
  writeFileSync(path.join(directory, "staff-login.txt"), instructions, { mode: 0o600, flag: "wx" });
  writeFileSync(file, JSON.stringify(credentials, null, 2), { mode: 0o600, flag: "wx" });
  console.log("Local staff accounts ready. Sign-in details: .local/staff-login.txt (excluded from Git).");
  return credentials;
}

export function createStaffAuth(credentials: Credentials, now: () => number = Date.now) {
  const sessions = new Map<string, { name: StaffName; expiresAt: number }>();
  const failures = new Map<string, { count: number; until: number }>();
  const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
  const tokenFrom = (request: Request) => {
    const token = request.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  };
  const currentStaff = (request: Request): StaffName | undefined => {
    const token = tokenFrom(request);
    if (!token) return;
    const key = tokenHash(token);
    const session = sessions.get(key);
    if (session && session.expiresAt > now()) return session.name;
    sessions.delete(key);
  };
  const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/" };

  const sameOrigin: RequestHandler = (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) { next(); return; }
    const origin = request.get("origin");
    if (request.get("sec-fetch-site") === "cross-site" || (origin && origin !== `${request.protocol}://${request.get("host")}`)) {
      response.status(403).json({ error: "Use the Juniper Salon page to make this change." });
      return;
    }
    next();
  };

  const login: RequestHandler = (request, response) => {
    response.set("Cache-Control", "no-store");
    const ip = request.ip ?? "local";
    const attempts = failures.get(ip);
    if (attempts && attempts.until > now() && attempts.count >= 5) {
      response.set("Retry-After", String(Math.ceil((attempts.until - now()) / 1000)));
      response.status(429).json({ error: "Too many unsuccessful attempts. Please try again in a minute." });
      return;
    }
    const username = typeof request.body?.username === "string" ? request.body.username.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const known = names.includes(username as StaffName);
    const credential = credentials[known ? username as StaffName : "lena"];
    const hash = scryptSync(password.slice(0, 1024), credential.salt, 64);
    if (!known || password.length > 1024 || !timingSafeEqual(hash, Buffer.from(credential.hash, "hex"))) {
      const prior = attempts && attempts.until > now() ? attempts : { count: 0, until: now() + 60000 };
      failures.set(ip, { ...prior, count: prior.count + 1 });
      response.status(401).json({ error: "The staff account or password is incorrect." });
      return;
    }
    failures.delete(ip);
    const oldToken = tokenFrom(request);
    if (oldToken) sessions.delete(tokenHash(oldToken));
    for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key);
    const token = randomBytes(32).toString("base64url");
    sessions.set(tokenHash(token), { name: username as StaffName, expiresAt: now() + SESSION_MS });
    response.cookie(COOKIE, token, { ...cookieOptions, secure: request.secure, maxAge: SESSION_MS });
    response.json({ staff: username });
  };

  const requireStaff: RequestHandler = (request, response, next) => {
    response.set("Cache-Control", "no-store");
    const staff = currentStaff(request);
    if (staff) { response.locals.staff = staff; next(); return; }
    if (request.originalUrl.startsWith("/api/")) response.status(401).json({ error: "Please sign in as Lena or Carla." });
    else response.redirect("/login");
  };

  const logout: RequestHandler = (request, response) => {
    const token = tokenFrom(request);
    if (token) sessions.delete(tokenHash(token));
    response.clearCookie(COOKIE, cookieOptions);
    response.set("Cache-Control", "no-store").json({ signedOut: true });
  };
  return { login, logout, requireStaff, sameOrigin, currentStaff };
}
