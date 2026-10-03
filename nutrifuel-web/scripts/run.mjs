import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const root = new URL("../", import.meta.url);
const toPath = relative => fileURLToPath(new URL(relative, root));
let args;
const env = { ...process.env };

if (mode === "dev") {
  env.NODE_ENV ??= "development";
  args = [toPath("node_modules/tsx/dist/cli.mjs"), "watch", "server/_core/index.ts"];
} else if (mode === "start") {
  env.NODE_ENV ??= "production";
  args = [toPath("dist/index.js")];
} else if (mode === "static") {
  args = [toPath("node_modules/vite/bin/vite.js"), "--host", "0.0.0.0", "--port", env.PORT || "3000", "--strictPort"];
} else {
  console.error("Usage: node scripts/run.mjs <dev|start|static>");
  process.exit(2);
}

const child = spawn(process.execPath, args, { cwd: fileURLToPath(root), env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(`Could not start NutriFuel: ${error.message}`); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
