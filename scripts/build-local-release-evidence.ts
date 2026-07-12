import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type EvidenceState =
  | "passed"
  | "failed"
  | "skipped"
  | "flaky-retried"
  | "explicitly_unclaimed"
  | "externally_unavailable";

interface EvidenceDocument {
  testId: string;
  state: EvidenceState;
  candidateCommit: string;
  [key: string]: unknown;
}

interface ReleaseScope {
  manifestVersion: string;
  deploymentProfile: string;
  featureRevision: string;
  capabilities: Array<{
    id: string;
    state: "mandatory" | "explicitly_unclaimed" | "externally_unavailable";
    owner: string;
    reachabilityOracle: string;
  }>;
}

interface EnablementPolicy {
  policyRevision: string;
  capabilityRevision: string;
  deploymentTopology: string;
}

interface OwnerDecisions {
  revision: string;
  decisions: Array<{
    id: string;
    state: EvidenceState;
    decidedAt: string;
    owner: string;
    reason: string;
  }>;
}

const repositoryRoot = resolve(dirname(import.meta.dir));
const inputDirectory = resolve(
  process.env.MYMY_RELEASE_EVIDENCE_DIR ??
    join(repositoryRoot, "release-evidence", "inputs"),
);
const outputDirectory = resolve(
  process.env.MYMY_RELEASE_BUNDLE_DIR ??
    join(repositoryRoot, "release-evidence", "bundle"),
);
const scope = readJson<ReleaseScope>(
  join(repositoryRoot, "api/tests/fixtures/july11_release_scope.json"),
);
const policy = readJson<EnablementPolicy>(
  join(repositoryRoot, "api/tests/fixtures/local_release_enablement_policy.json"),
);
const ownerDecisions = readJson<OwnerDecisions>(
  join(repositoryRoot, "api/tests/fixtures/local_release_owner_decisions.json"),
);
const candidateCommit = resolveCandidateCommit();

if (
  policy.capabilityRevision !== scope.featureRevision ||
  policy.deploymentTopology !== scope.deploymentProfile
) {
  throw new Error("release scope and enablement policy revisions do not match");
}

const requiredInputs = [
  ["loc01-stateful-browser.json", "LOC-01-stateful-browser-journeys"],
  ["loc02-overlap.json", "LOC-02-integrated-overlap"],
  ["loc03-enablement.json", "LOC-03-server-authoritative-enablement"],
  ["loc04-libreoffice-interop.json", "LOC-04-libreoffice-document-interop"],
  ["loc06-delivery-static.json", "LOC-06-static-delivery-budget"],
  ["loc06-delivery-runtime.json", "LOC-06-runtime-delivery-budget"],
] as const;

const evidence = Object.fromEntries(
  requiredInputs.map(([fileName, testId]) => {
    const document = readJson<EvidenceDocument>(join(inputDirectory, fileName));
    assertState(document.state, `${fileName}.state`);
    if (document.testId !== testId) {
      throw new Error(`${fileName} has testId ${document.testId}; expected ${testId}`);
    }
    if (document.state !== "passed") {
      throw new Error(`${testId} is ${document.state}; required executed evidence did not pass`);
    }
    if (document.candidateCommit !== candidateCommit) {
      throw new Error(
        `${testId} belongs to ${document.candidateCommit}; candidate is ${candidateCommit}`,
      );
    }
    validateNestedStates(document, fileName);
    return [testId, document];
  }),
) as Record<string, EvidenceDocument>;

for (const decision of ownerDecisions.decisions) {
  assertState(decision.state, `${decision.id}.state`);
  if (decision.state === "passed") {
    throw new Error(`${decision.id} is an owner exclusion and cannot serialize as passed`);
  }
  for (const key of ["decidedAt", "owner", "reason"] as const) {
    if (!decision[key].trim()) throw new Error(`${decision.id}.${key} is empty`);
  }
}

const loc01 = evidence["LOC-01-stateful-browser-journeys"];
const loc02 = evidence["LOC-02-integrated-overlap"];
const loc03 = evidence["LOC-03-server-authoritative-enablement"];
const libreOffice = evidence["LOC-04-libreoffice-document-interop"];
const loc06Static = evidence["LOC-06-static-delivery-budget"];
const loc06Runtime = evidence["LOC-06-runtime-delivery-budget"];
const migrationMaximum = maximumMigration();
const signedAt = new Date().toISOString();
const signer =
  process.env.GITLAB_USER_LOGIN ??
  process.env.USER ??
  "local-release-operator";

const testResults = [
  ...Object.values(evidence).map((document) => ({
    id: document.testId,
    state: document.state,
  })),
  ...ownerDecisions.decisions.map((decision) => ({
    id: decision.id,
    state: decision.state,
    reason: decision.reason,
  })),
];
const stateCounts = testResults.reduce<Record<string, number>>((counts, result) => {
  counts[result.state] = (counts[result.state] ?? 0) + 1;
  return counts;
}, {});

const bundle = {
  bundleVersion: "july11-local-release-evidence-v1",
  state: "signed_off",
  candidateCommit,
  migrationMaximum,
  deploymentTopology: scope.deploymentProfile,
  capabilityRevision: scope.featureRevision,
  enablementPolicyRevision: policy.policyRevision,
  scopeManifestVersion: scope.manifestVersion,
  generatedAt: signedAt,
  signoff: {
    state: "signed_off",
    signer,
    ciJobId: process.env.CI_JOB_ID ?? null,
    statement:
      "Executed results are reported exactly; excluded and unavailable scope is not represented as passed.",
  },
  resultSummary: stateCounts,
  testResults,
  exactTests: {
    loc01: loc01.tests,
    loc03: loc03.tests,
  },
  producerVersions: {
    browsers: [loc01.browser, { engine: "chromium", version: loc06Runtime.browserVersion }],
    libreOffice: libreOffice.producer,
  },
  performanceMetrics: {
    overlap: {
      thresholds: loc02.thresholds,
      latencies: loc02.latencies,
      maximumQueueAgeMs: loc02.maximumQueueAgeMs,
      rssBaselineBytes: loc02.rssBaselineBytes,
      maximumRssBytes: loc02.maximumRssBytes,
      fileDescriptorsBaseline: loc02.fileDescriptorsBaseline,
      maximumFileDescriptors: loc02.maximumFileDescriptors,
      maximumDatabaseConnections: loc02.maximumDatabaseConnections,
    },
    frontendDelivery: {
      budgets: loc06Static.budgets,
      entry: loc06Static.entry,
      routes: loc06Static.routes,
      initialParseExecuteMs: loc06Runtime.initialParseExecuteMs,
      lazyRecoveryState: loc06Runtime.lazyRecoveryState,
    },
  },
  deterministicSeeds: {
    loc01: loc01.seed,
    loc02: loc02.seed,
  },
  settledWatermarks: loc02.watermarks,
  cleanup: {
    loc01: loc01.cleanup,
    loc02: loc02.cleanup,
    loc02DelayedTail: loc02.delayedTailWork,
    libreOffice: libreOffice.cleanup,
  },
  capabilityScope: scope.capabilities,
  unclaimedAndExternal: [
    ...scope.capabilities.filter((capability) => capability.state !== "mandatory"),
    ...ownerDecisions.decisions,
  ],
  ownerDecisionRevision: ownerDecisions.revision,
};

validateNestedStates(bundle, "bundle");
mkdirSync(outputDirectory, { recursive: true });
const bundleName = "local-release-evidence.json";
const bundleBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
const digest = createHash("sha256").update(bundleBytes).digest("hex");
writeFileSync(join(outputDirectory, bundleName), bundleBytes);
writeFileSync(
  join(outputDirectory, `${bundleName}.sha256`),
  `${digest}  ${bundleName}\n`,
);
writeFileSync(
  join(outputDirectory, "local-release-evidence.signoff.json"),
  `${JSON.stringify(
    {
      state: "signed_off",
      algorithm: "SHA-256",
      digest,
      artifact: bundleName,
      signer,
      signedAt,
      statement: bundle.signoff.statement,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `release-evidence candidate=${candidateCommit} tests=${testResults.length} digest=${digest} result=signed_off`,
);

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`cannot read evidence ${path}: ${String(error)}`);
  }
}

function assertState(value: unknown, path: string): asserts value is EvidenceState {
  const allowed: EvidenceState[] = [
    "passed",
    "failed",
    "skipped",
    "flaky-retried",
    "explicitly_unclaimed",
    "externally_unavailable",
  ];
  if (typeof value !== "string" || !allowed.includes(value as EvidenceState)) {
    throw new Error(`${path} has unsupported evidence state ${String(value)}`);
  }
}

function validateNestedStates(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNestedStates(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "state" && typeof child === "string") {
      if (!["mandatory", "signed_off"].includes(child)) assertState(child, childPath);
    }
    validateNestedStates(child, childPath);
  }
}

function resolveCandidateCommit() {
  if (process.env.CI_COMMIT_SHA) return process.env.CI_COMMIT_SHA;
  if (process.env.MYMY_ALLOW_WORKING_TREE_EVIDENCE === "1") return "working-tree";
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error("candidate commit is unavailable");
  return result.stdout.toString().trim();
}

function maximumMigration() {
  const migrationDirectory = join(repositoryRoot, "api/migrations");
  const entries = readdirSync(migrationDirectory)
    .map((fileName) => {
      const match = /^(\d+)_.*\.sql$/.exec(fileName);
      return match ? { version: Number(match[1]), fileName } : null;
    })
    .filter((entry): entry is { version: number; fileName: string } => entry !== null)
    .sort((left, right) => left.version - right.version);
  const maximum = entries.at(-1);
  if (!maximum) throw new Error(`no SQL migrations found in ${basename(migrationDirectory)}`);
  return maximum;
}
