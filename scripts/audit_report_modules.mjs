import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERIC_JUDGMENT_PATTERNS,
  MODULE_DRILLDOWN_REQUIRED_PREFIXES,
  MODULE_QUALITY_MARKERS,
  REPORT_OUTPUT_MODULE_IDS,
  REPORT_OUTPUT_TEMPLATE_VERSION,
  REQUIRED_MINDMAP_BRANCHES,
  REQUIRED_OUTPUT_SECTIONS,
  validateReportOutputQualityContract,
  validateReportOutputMetaContract
} from "../server/report-output-quality-rules.mjs";
import { resolveReportsDir } from "./local-storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const reportsDir = resolveReportsDir(process.env);

const DEFAULT_MODULES = REPORT_OUTPUT_MODULE_IDS;

function parseArgs(argv) {
  const args = {
    app: "MEEFF",
    all: false,
    modules: DEFAULT_MODULES,
    allowMissing: ["experience"],
    requireAi: true,
    templateVersion: "latest"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") args.all = true;
    else if (arg === "--app") args.app = argv[++index] || args.app;
    else if (arg === "--modules") args.modules = (argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--allow-missing") args.allowMissing = (argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--no-require-ai") args.requireAi = false;
    else if (arg === "--template-version") args.templateVersion = argv[++index] || "latest";
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/audit_report_modules.mjs [--app MEEFF] [--template-version 13]",
    "       node scripts/audit_report_modules.mjs --all",
    "",
    "Audits generated report module Markdown files for evidence-chain analysis structure:",
    "- required sections",
    "- evidence ledger",
    "- judgment-evidence matrix",
    "- module-specific breakdown markers",
    "- evidence-chain index",
    "- Mermaid mindmap",
    "- meta sidecar / template version / AI status"
  ].join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const contractFailures = validateReportOutputQualityContract(REPORT_OUTPUT_MODULE_IDS);
  if (contractFailures.length) {
    console.error("\nReport output quality contract failed:");
    for (const failure of contractFailures) console.error(`- ${failure}`);
    process.exit(1);
  }
  const appNames = args.all ? listAppDirs() : [args.app];
  const allFailures = [];
  for (const appName of appNames) {
    const result = auditApp(appName, args);
    allFailures.push(...result.failures.map((failure) => `${appName}: ${failure}`));
  }

  if (allFailures.length) {
    console.error("\nReport module audit failed:");
    for (const failure of allFailures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`\nReport module audit passed for ${appNames.join(", ")}.`);
}

function auditApp(appName, args) {
  const appDir = path.join(reportsDir, "modules", appName);
  if (!fs.existsSync(appDir)) {
    return { appName, failures: [`missing app module dir ${relative(appDir)}`], rows: [] };
  }
  const expectedTemplateVersion = resolveExpectedTemplateVersion(appDir, args);
  const failures = [];
  const rows = [];

  for (const moduleId of args.modules) {
    const mdPath = path.join(appDir, `${moduleId}.md`);
    const metaPath = path.join(appDir, `${moduleId}.meta.json`);
    const mindmapPath = path.join(appDir, `${moduleId}.mmd`);
    const missingAllowed = args.allowMissing.includes(moduleId);

    if (!fs.existsSync(mdPath)) {
      if (missingAllowed) {
        rows.push({ moduleId, status: "allowed_missing" });
        continue;
      }
      failures.push(`${moduleId}: missing markdown ${relative(mdPath)}`);
      continue;
    }

    const markdown = fs.readFileSync(mdPath, "utf8");
    const meta = readJson(metaPath);
    const moduleFailures = auditModule({ moduleId, markdown, meta, args, metaPath, mindmapPath, expectedTemplateVersion });
    failures.push(...moduleFailures);
    rows.push({
      moduleId,
      status: moduleFailures.length ? "failed" : "ok",
      aiStatus: meta?.aiStatus || "",
      templateVersion: meta?.templateVersion || ""
    });
  }

  for (const row of rows) {
    console.log(`${appName}\t${row.moduleId}\t${row.status}\t${row.aiStatus || "-"}\t${row.templateVersion || "-"}`);
  }

  return { appName, failures, rows };
}

function listAppDirs() {
  const modulesDir = path.join(reportsDir, "modules");
  try {
    return fs.readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function auditModule({ moduleId, markdown, meta, args, metaPath, mindmapPath, expectedTemplateVersion }) {
  const failures = [];
  for (const section of REQUIRED_OUTPUT_SECTIONS) {
    if (!markdown.includes(section)) failures.push(`${moduleId}: missing section "${section}"`);
  }
  if (!/\| ID \| 类型 \| 信号 \| 证据摘要 \| 可支撑什么 \|/.test(markdown)) {
    failures.push(`${moduleId}: missing evidence ledger table`);
  }
  if (!/\| 判断 \| 支撑证据 \| 置信度 \| 可进入报告的位置 \|/.test(markdown)) {
    failures.push(`${moduleId}: missing judgment-evidence matrix table`);
  }
  if (!/\| 信号 \| 样本 \/ 原文 \| 来源证据 \| 能说明什么 \| 边界 \|/.test(markdown)) {
    failures.push(`${moduleId}: missing signal drilldown table`);
  }
  if (!/\| 可写位置 \| 判断摘要 \| 核心证据链 \| 引用边界 \|/.test(markdown)) {
    failures.push(`${moduleId}: missing evidence-chain index table`);
  }
  const drilldown = extractBetween(markdown, "## 8. 信号下钻 / 原文样本", "## 9.");
  if (!/[ADVRCTXN]\d+/.test(drilldown)) failures.push(`${moduleId}: signal drilldown has no evidence IDs`);
  const missingDrilldownTypes = missingRequiredEvidencePrefixes(drilldown, MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId] || []);
  if (missingDrilldownTypes.length) failures.push(`${moduleId}: signal drilldown missing required evidence prefixes: ${missingDrilldownTypes.join(", ")}`);
  const matrix = extractBetween(markdown, "## 9. 判断 - 证据矩阵", "## 10.");
  if (!/[ADVRCTXN]\d+/.test(matrix)) failures.push(`${moduleId}: matrix has no evidence IDs`);
  if (GENERIC_JUDGMENT_PATTERNS.some((pattern) => pattern.test(matrix))) {
    failures.push(`${moduleId}: matrix contains generic placeholder judgment`);
  }
  const ledgerIds = extractEvidenceLedgerIds(markdown);
  if (!ledgerIds.size) failures.push(`${moduleId}: evidence ledger has no parseable IDs`);
  const invalidMatrixIds = evidenceIdsNotInLedger(matrix, ledgerIds);
  if (invalidMatrixIds.length) failures.push(`${moduleId}: matrix references IDs not in ledger: ${invalidMatrixIds.join(", ")}`);
  const invalidDrilldownIds = evidenceIdsNotInLedger(drilldown, ledgerIds);
  if (invalidDrilldownIds.length) failures.push(`${moduleId}: signal drilldown references IDs not in ledger: ${invalidDrilldownIds.join(", ")}`);
  const aiSection = extractBetween(markdown, "## 10. AI 结构化洞察", "## 11.");
  const invalidAiIds = evidenceIdsNotInLedger(aiSection, ledgerIds);
  if (invalidAiIds.length) failures.push(`${moduleId}: AI insights reference IDs not in ledger: ${invalidAiIds.join(", ")}`);
  const breakdown = extractBetween(markdown, "## 7. 模块专属拆解", "## 8.");
  for (const marker of MODULE_QUALITY_MARKERS[moduleId] || []) {
    if (!breakdown.includes(marker)) failures.push(`${moduleId}: missing module-specific marker "${marker}"`);
  }
  const evidenceChain = extractBetween(markdown, "## 14. 证据链索引", "## 15.");
  if (!/[ADVRCTXN]\d+/.test(evidenceChain)) failures.push(`${moduleId}: evidence-chain index has no evidence IDs`);
  const invalidChainIds = evidenceIdsNotInLedger(evidenceChain, ledgerIds);
  if (invalidChainIds.length) failures.push(`${moduleId}: evidence-chain index references IDs not in ledger: ${invalidChainIds.join(", ")}`);
  if (!/```mermaid\s+mindmap/.test(markdown)) failures.push(`${moduleId}: missing Mermaid mindmap`);
  if (!meta?.mindmapPath) failures.push(`${moduleId}: missing mindmapPath in meta`);
  if (!fs.existsSync(mindmapPath)) {
    failures.push(`${moduleId}: missing standalone mindmap ${relative(mindmapPath)}`);
  } else {
    const mindmap = fs.readFileSync(mindmapPath, "utf8");
    if (!/^\s*mindmap\b/m.test(mindmap)) failures.push(`${moduleId}: standalone mindmap is not Mermaid mindmap`);
    if (mindmap.trim().split(/\r?\n/).length < 4) failures.push(`${moduleId}: standalone mindmap is missing multiline structure`);
    if (!/\n\s{2,}\S/.test(mindmap)) failures.push(`${moduleId}: standalone mindmap is missing indented nodes`);
    for (const branch of REQUIRED_MINDMAP_BRANCHES) {
      if (!mindmap.includes(branch)) failures.push(`${moduleId}: standalone mindmap missing branch "${branch}"`);
    }
    if (!/[ADVRCTXN]\d+/.test(mindmap)) failures.push(`${moduleId}: standalone mindmap has no evidence IDs`);
    const missingMindmapTypes = missingRequiredEvidencePrefixes(mindmap, MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId] || []);
    if (missingMindmapTypes.length) failures.push(`${moduleId}: standalone mindmap missing required evidence prefixes: ${missingMindmapTypes.join(", ")}`);
    const invalidMindmapIds = evidenceIdsNotInLedger(mindmap, ledgerIds);
    if (invalidMindmapIds.length) failures.push(`${moduleId}: standalone mindmap references IDs not in ledger: ${invalidMindmapIds.join(", ")}`);
  }
  if (!meta) failures.push(`${moduleId}: missing or invalid meta ${relative(metaPath)}`);
  if (meta && expectedTemplateVersion && Number(meta.templateVersion || 0) !== expectedTemplateVersion) {
    failures.push(`${moduleId}: templateVersion ${meta.templateVersion || "missing"} !== ${expectedTemplateVersion}`);
  }
  if (meta) {
    const metaContractFailures = validateReportOutputMetaContract(meta, moduleId);
    failures.push(...metaContractFailures.map((failure) => `${moduleId}: qualityContract ${failure}`));
  }
  if (meta && args.requireAi && meta.aiStatus !== "ready") {
    failures.push(`${moduleId}: aiStatus ${meta.aiStatus || "missing"} is not ready`);
  }
  if (meta && !meta.sourceFingerprint) failures.push(`${moduleId}: missing sourceFingerprint`);
  if (meta && (!meta.sourceSummary || typeof meta.sourceSummary !== "object")) {
    failures.push(`${moduleId}: missing sourceSummary`);
  } else if (meta?.sourceSummary) {
    if (!meta.sourceSummary.moduleId) failures.push(`${moduleId}: sourceSummary missing moduleId`);
    if (!Number.isFinite(Number(meta.sourceSummary.total))) failures.push(`${moduleId}: sourceSummary missing total`);
  }
  return failures;
}

function resolveExpectedTemplateVersion(appDir, args) {
  if (args.templateVersion && args.templateVersion !== "latest") {
    return Number(args.templateVersion) || null;
  }
  if (REPORT_OUTPUT_TEMPLATE_VERSION) return REPORT_OUTPUT_TEMPLATE_VERSION;
  let maxVersion = 0;
  try {
    for (const entry of fs.readdirSync(appDir)) {
      if (!entry.endsWith(".meta.json")) continue;
      const meta = readJson(path.join(appDir, entry));
      maxVersion = Math.max(maxVersion, Number(meta?.templateVersion || 0));
    }
  } catch {
    return null;
  }
  return maxVersion || null;
}

function extractBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = text.indexOf(end, startIndex + start.length);
  return text.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}

function extractEvidenceLedgerIds(markdown = "") {
  const ledger = extractBetween(markdown, "## 4. 证据台账", "## 5.");
  const ids = [...ledger.matchAll(/^\|\s*([ADVRCTXN]\d+)\s*\|/gm)].map((match) => match[1]);
  return new Set(ids);
}

function evidenceIdsNotInLedger(text = "", ledgerIds = new Set()) {
  if (!ledgerIds.size) return [];
  const ids = [...text.matchAll(/\b([ADVRCTXN]\d+)\b/g)].map((match) => match[1]);
  return [...new Set(ids.filter((id) => !ledgerIds.has(id)))].slice(0, 12);
}

function missingRequiredEvidencePrefixes(text = "", requirements = []) {
  return requirements.filter((requirement) => {
    const alternatives = String(requirement).split("|").map((item) => item.trim()).filter(Boolean);
    return !alternatives.some((prefix) => new RegExp(`\\b${prefix}\\d+\\b`).test(text));
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function relative(filePath) {
  return path.relative(projectRoot, filePath);
}

main();
