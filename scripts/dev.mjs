import { connect } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

let nativeEnvironment;
if (process.argv.includes("--native")) {
  const { TestWorkflowEnvironment } = await import("@temporalio/testing");
  await mkdir(path.resolve(".local"), { recursive: true });
  console.log("Starting a native Temporal dev server (first run may download it)...");
  nativeEnvironment = await TestWorkflowEnvironment.createLocal({
    server: {
      ip: "127.0.0.1",
      port: 7233,
      uiPort: 8233,
      dbFilename: path.resolve(".local/temporal.db"),
    },
  });
} else {
  const compose = spawnSync("docker", ["compose", "up", "-d", "temporal"], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (compose.status !== 0) {
    console.error("\nCould not start Docker. Start Docker Desktop, or use npm run dev:local.");
    process.exit(compose.status ?? 1);
  }
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Temporal did not become ready on port ${port}.`);
}

await waitForPort(7233);
const children = [
  "src/worker.ts", "src/api.ts",
].map((entrypoint) => spawn(process.execPath, ["--import", "tsx", entrypoint], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, TEMPORAL_ADDRESS: "127.0.0.1:7233" },
}));
let shuttingDown = false;
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  if (nativeEnvironment) await nativeEnvironment.teardown();
  process.exit(exitCode);
}
process.on("SIGINT", () => { void shutdown(0); });
process.on("SIGTERM", () => { void shutdown(0); });
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`A development process stopped (${signal ?? code}).`);
      void shutdown(code ?? 1);
    }
  });
}
console.log("\nJuniper Salon is launching:");
console.log("  App:         http://localhost:3000");
console.log("  Temporal UI: http://localhost:8233\n");

