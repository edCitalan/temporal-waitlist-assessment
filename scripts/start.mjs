// A fresh checkout needs only Node/npm and this command: npm start.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error("Juniper requires Node.js 20 or newer.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const required = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
if (required.some(name => !existsSync(path.join(root, "node_modules", name, "package.json")))) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    console.error("Start the prototype with npm start so dependencies can be installed automatically.");
    process.exit(1);
  }
  console.log("Installing the locked dependencies for this checkout...");
  const installation = spawnSync(process.execPath, [npmCli, "ci"], { cwd: root, stdio: "inherit", windowsHide: true });
  if (installation.error || installation.status !== 0) {
    console.error("Dependency installation failed. Check the npm output and run npm start again.");
    process.exit(installation.status || 1);
  }
}
process.argv.push("--native");
await import("./dev.mjs");
