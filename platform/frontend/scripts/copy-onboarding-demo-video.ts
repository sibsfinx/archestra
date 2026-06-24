import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const workspaceRoot = resolve(frontendRoot, "../../..");
const resultsRoot = resolve(workspaceRoot, "recordings/.demo/test-results");

function findNewestVideo(dir: string): string | null {
  if (!existsSync(dir)) return null;
  let newest: string | null = null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findNewestVideo(path);
      if (nested) newest = pickNewer(newest, nested);
      continue;
    }
    if (entry.name === "video.webm") {
      newest = pickNewer(newest, path);
    }
  }
  return newest;
}

function pickNewer(current: string | null, candidate: string): string {
  if (!current) return candidate;
  return statSync(candidate).mtimeMs > statSync(current).mtimeMs
    ? candidate
    : current;
}

const source = findNewestVideo(resultsRoot);
if (!source) {
  console.error("No Playwright demo video found under", resultsRoot);
  process.exit(1);
}

const target = resolve(workspaceRoot, "recordings/onboarding-smtp-flow.webm");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("Copied demo video to", target);
