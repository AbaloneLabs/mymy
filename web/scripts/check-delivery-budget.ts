import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";

interface Budget {
  revision: string;
  maximumEntryCompressedBytes: number;
  maximumRouteCompressedBytes: number;
  maximumInitialParseExecuteMs: number;
  requiredLazyRecoveryRoute: string;
}

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  css?: string[];
}

interface ChunkBudget {
  compressedBytes: number;
  files: string[];
}

const root = dirname(import.meta.dir);
const dist = join(root, "dist");
const budget = JSON.parse(
  readFileSync(join(root, "performance-budgets.json"), "utf8"),
) as Budget;
const manifest = JSON.parse(
  readFileSync(join(dist, ".vite/manifest.json"), "utf8"),
) as Record<string, ManifestChunk>;

const entryRecord = Object.entries(manifest).find(([, chunk]) => chunk.isEntry);
if (!entryRecord) throw new Error("Vite manifest has no entry chunk");
const entryFiles = collectStaticFiles(entryRecord[0]);
const entry = summarize(entryFiles);
if (entry.compressedBytes > budget.maximumEntryCompressedBytes) {
  throw new Error(
    `Compressed entry ${entry.compressedBytes} exceeds ${budget.maximumEntryCompressedBytes} bytes`,
  );
}

const routes = Object.fromEntries(
  Object.entries(manifest)
    .filter(([key, chunk]) => key.startsWith("src/routes/") && chunk.isDynamicEntry)
    .map(([key]) => {
      const routeFiles = collectStaticFiles(key);
      for (const initialFile of entryFiles) routeFiles.delete(initialFile);
      const summary = summarize(routeFiles);
      if (summary.compressedBytes > budget.maximumRouteCompressedBytes) {
        throw new Error(
          `${key} compressed bytes ${summary.compressedBytes} exceed ${budget.maximumRouteCompressedBytes}`,
        );
      }
      return [key, summary];
    }),
) as Record<string, ChunkBudget>;

if (!routes[budget.requiredLazyRecoveryRoute]) {
  throw new Error(
    `Required lazy recovery route is not a dynamic entry: ${budget.requiredLazyRecoveryRoute}`,
  );
}

const output = {
  testId: "LOC-06-static-delivery-budget",
  state: "passed",
  revision: budget.revision,
  candidateCommit: process.env.CI_COMMIT_SHA ?? "working-tree",
  budgets: budget,
  entry,
  routes,
};
const evidenceDirectory = process.env.MYMY_RELEASE_EVIDENCE_DIR;
if (evidenceDirectory) {
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(
    join(evidenceDirectory, "loc06-delivery-static.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
}
console.log(
  `delivery-budget revision=${budget.revision} entry=${entry.compressedBytes} maxRoute=${Math.max(...Object.values(routes).map((route) => route.compressedBytes))} result=passed`,
);

function collectStaticFiles(key: string, files = new Set<string>()) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return files;
  files.add(chunk.file);
  for (const css of chunk.css ?? []) files.add(css);
  for (const imported of chunk.imports ?? []) collectStaticFiles(imported, files);
  return files;
}

function summarize(files: Set<string>): ChunkBudget {
  const ordered = [...files].sort();
  return {
    compressedBytes: ordered.reduce(
      (total, file) => total + gzipSync(readFileSync(join(dist, file))).byteLength,
      0,
    ),
    files: ordered,
  };
}
