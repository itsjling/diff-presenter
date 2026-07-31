#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cases = ["build", "summary", "present", "restart"];
const fixtureNames = ["working", "heldout"];

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction) =>
    sorted[Math.floor((sorted.length - 1) * fraction)];
  return {
    minMs: sorted[0],
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted.at(-1),
    samplesMs: values,
  };
}

function pipelineSamples(pipeline, name) {
  if (name === "present") return pipeline.present.snapshot.samplesMs;
  return pipeline[name].samplesMs;
}

function metricDefinition(name) {
  if (name === "present") {
    return {
      start: "presenter process start",
      stop: "diff snapshot ready for local transport (not browser rendering)",
    };
  }
  if (name === "restart") {
    return {
      start: "repository edit after the first agent request",
      stop: "current restarted notes written to the local transport snapshot",
    };
  }
  if (name === "summary") {
    return {
      start: "summary command start",
      stop: "summary command completion",
    };
  }
  return {
    start: "snapshot build command start",
    stop: "snapshot build command completion",
  };
}

function runPipeline(fixture, selectedCase, sampleRules) {
  const totalRuns =
    sampleRules.warmupSamples + sampleRules.measuredSamples;
  const output = execFileSync(
    process.execPath,
    [
      resolve(root, "benchmarks/pipeline-speed.mjs"),
      "--case",
      selectedCase,
      "--runs",
      String(totalRuns),
      "--fixture",
      fixture,
    ],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(output);
}

function measureFixture({
  selectedCases,
  sampleRules,
  thresholds,
  dryRun,
  pipeline,
}) {
  return Object.fromEntries(
    selectedCases.map((name) => {
      const allSamples = dryRun
        ? Array(
            sampleRules.warmupSamples + sampleRules.measuredSamples,
          ).fill(1)
        : pipelineSamples(pipeline, name);
      const measured = allSamples.slice(sampleRules.warmupSamples);
      const result = {
        name,
        ...metricDefinition(name),
        ...stats(measured),
        thresholdMs: thresholds[name],
      };
      return [name, {
        ...result,
        passed: result.medianMs <= result.thresholdMs,
      }];
    }),
  );
}

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function qualityResult(fixture, threshold) {
  const note = fixture.note || {};
  const text = [
    note.title,
    note.what,
    note.why,
    ...(Array.isArray(note.details) ? note.details : []),
    ...(Array.isArray(note.risks) ? note.risks : []),
  ].map(normalized).filter(Boolean).join(" ");
  const mainFields = [note.title, note.what, note.why].map(normalized);
  const items = {
    complete: mainFields.every(Boolean),
    grounded: fixture.unsupportedTerms.every(
      (term) => !text.includes(normalized(term)),
    ),
    specific: fixture.requiredTerms.every(
      (term) => text.includes(normalized(term)),
    ),
    distinct: new Set(mainFields).size === mainFields.length,
  };
  const score = Object.values(items).filter(Boolean).length;
  const actualPass = score >= threshold.minimumScore;
  return {
    expectedPass: fixture.expectedPass,
    actualPass,
    score,
    threshold: threshold.minimumScore,
    items,
    failedItems: Object.entries(items)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    passed: actualPass === fixture.expectedPass,
  };
}

function selectedGeneratedNote(generatedNotes, fixtureName, required) {
  const generatedNote = generatedNotes?.[fixtureName];
  if (generatedNote) return generatedNote;
  if (required) return {};
}

function pipelineQuality(fixtures, fixtureName, threshold, generatedNote) {
  if (!generatedNote) return {};
  return {
    pipeline: qualityResult(
      {
        ...fixtures[fixtureName].find((fixture) => fixture.name === "useful"),
        expectedPass: true,
        note: generatedNote,
      },
      threshold,
    ),
  };
}

function evaluateQuality(
  fixtures,
  threshold,
  generatedNotes,
  requireGeneratedNotes,
) {
  return Object.fromEntries(
    fixtureNames.map((fixtureName) => [
      fixtureName,
      {
        ...Object.fromEntries(
          fixtures[fixtureName].map((fixture) => [
            fixture.name,
            qualityResult(fixture, threshold),
          ]),
        ),
        ...pipelineQuality(
          fixtures,
          fixtureName,
          threshold,
          selectedGeneratedNote(
            generatedNotes,
            fixtureName,
            requireGeneratedNotes,
          ),
        ),
      },
    ]),
  );
}

function speedFailures(measurements) {
  return fixtureNames.flatMap((fixture) =>
    Object.values(measurements[fixture])
      .filter((measurement) => !measurement.passed)
      .map((measurement) => ({
        target: fixture,
        metric: measurement.name,
        observedMedianMs: measurement.medianMs,
        thresholdMs: measurement.thresholdMs,
        message:
          `${fixture} ${measurement.name} medianMs ` +
          `${measurement.medianMs} exceeded ${measurement.thresholdMs}`,
      })),
  );
}

function qualityFailures(quality) {
  return fixtureNames.flatMap((fixture) =>
    Object.entries(quality[fixture])
      .filter(([, result]) => !result.passed)
      .map(([name, result]) => ({
        target: fixture,
        rubric: name,
        expectedPass: result.expectedPass,
        actualPass: result.actualPass,
        failedItems: result.failedItems,
        message:
          `${fixture} ${name} rubric expected pass=${result.expectedPass} ` +
          `but got pass=${result.actualPass}; failed items: ` +
          `${result.failedItems.join(", ") || "none"}`,
      })),
  );
}

const selectedCase = option("--case", "all");
if (selectedCase !== "all" && !cases.includes(selectedCase)) {
  throw new Error("--case must be all, build, summary, present, or restart");
}
const dryRun = args.includes("--dry-run");
const resultFile = option("--result-file");
const generatedNotesFile = option("--generated-notes");
const baseline = readJson(
  option("--baseline", "benchmarks/performance-baseline.json"),
);
const qualityFixtures = readJson(
  option("--quality-fixtures", "benchmarks/quality-fixtures.json"),
);
const selectedCases = selectedCase === "all" ? cases : [selectedCase];
const sampleRules = {
  warmupSamples: baseline.warmupSamples,
  measuredSamples: baseline.measuredSamples,
};
const pipelines = Object.fromEntries(
  fixtureNames.map((fixture) => [
    fixture,
    dryRun ? undefined : runPipeline(fixture, selectedCase, sampleRules),
  ]),
);
const measurements = Object.fromEntries(
  fixtureNames.map((fixture) => [
    fixture,
    measureFixture({
      selectedCases,
      sampleRules,
      thresholds: baseline.speedMs[fixture],
      dryRun,
      pipeline: pipelines[fixture],
    }),
  ]),
);
const generatedNotes = generatedNotesFile
  ? readJson(generatedNotesFile)
  : Object.fromEntries(
      fixtureNames.flatMap((fixture) => {
        const note = pipelines[fixture]?.generatedNote;
        return note ? [[fixture, note]] : [];
      }),
    );
const quality = evaluateQuality(
  qualityFixtures,
  baseline.quality,
  generatedNotes,
  Boolean(generatedNotesFile) ||
    (!dryRun &&
      (selectedCase === "all" || selectedCase === "summary")),
);
const failures = [
  ...speedFailures(measurements),
  ...qualityFailures(quality),
];
const result = {
  schemaVersion: 1,
  selectedCase,
  provider: "deterministic-fake",
  model: null,
  tool: "pipeline-speed",
  sampleRules: {
    ...sampleRules,
    warmup: "discard the first sample for each fixture and metric",
    variance: "record min, median, p95, max, and every measured sample",
    gate: "compare the median with the named fixture threshold",
  },
  measurements,
  quality,
  failures,
  passed: failures.length === 0,
};
const encoded = `${JSON.stringify(result, null, 2)}\n`;
if (resultFile) writeFileSync(resolve(resultFile), encoded);
process.stdout.write(encoded);
if (!result.passed) {
  process.stderr.write(
    `Performance gate failed:\n${failures
      .map((failure) => `- ${failure.message}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
}
