import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createApplicationServices
} from "../server/application-services.mjs";
import {
  createRuntimeConfig
} from "../server/runtime-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    app: "",
    module: "anomaly_signal",
    mode: "generate"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app") args.app = argv[++index] || "";
    else if (arg === "--module") args.module = argv[++index] || args.module;
    else if (arg === "--mode") args.mode = argv[++index] || args.mode;
    else if (arg === "--prepare") args.mode = "prepare";
    else if (arg === "--generate") args.mode = "generate";
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/run_report_ai_module.mjs --app calai --module anomaly_signal --mode prepare",
    "  node scripts/run_report_ai_module.mjs --app calai --module country_market_split --mode generate",
    "",
    "Modes:",
    "  prepare   清洗并写入 reports/ai-source-packs/<App>/<module>.json 和 .prompt.md，不调用 Agnes",
    "  generate  先 prepare，再调用 Agnes，最后写入 reports/modules/<App>/<module>.md"
  ].join("\n"));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.app) {
    console.error("缺少 --app。");
    printHelp();
    process.exit(1);
  }
  if (!["prepare", "generate"].includes(args.mode)) {
    console.error(`未知 --mode：${args.mode}`);
    process.exit(1);
  }

  const runtimeConfig = createRuntimeConfig(new URL("../server.mjs", import.meta.url), process.env);
  const applicationServices = createApplicationServices({
    runtimeConfig,
    env: process.env,
    logger: console
  });
  const services = applicationServices.routeDeps;
  const apps = await services.readApps();
  const app = resolveApp(apps, args.app);
  if (!app) {
    console.error(`找不到 App：${args.app}`);
    process.exit(1);
  }

  if (args.mode === "prepare") {
    const prepared = await services.prepareAppReportModuleAi(app.id, args.module);
    if (!prepared.available) {
      console.log(JSON.stringify({
        status: "unavailable",
        app: app.name || app.fullName || app.id,
        module: args.module,
        error: prepared.error
      }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      status: "prepared",
      app: app.name || app.fullName || app.id,
      module: args.module,
      sourcePackFilePath: prepared.sourcePackFilePath,
      promptFilePath: prepared.promptFilePath
    }, null, 2));
    return;
  }

  const generated = await services.generateAppReportModule(app.id, args.module);
  console.log(JSON.stringify({
    status: generated.generationStatus,
    app: app.name || app.fullName || app.id,
    module: generated.id,
    aiStatus: generated.aiStatus,
    aiError: generated.aiError,
    markdownFilePath: generated.markdownFilePath,
    mindmapFilePath: generated.mindmapFilePath,
    qualityStatus: generated.qualityStatus,
    qualityIssues: generated.qualityIssues || []
  }, null, 2));
}

function resolveApp(apps = [], query = "") {
  const target = normalizeLookup(query);
  if (!target) return null;
  return apps.find((app) => {
    const candidates = [app.id, app.name, app.fullName, app.bundleId, app.appStoreId].map(normalizeLookup).filter(Boolean);
    return candidates.some((candidate) => candidate === target || candidate.includes(target) || target.includes(candidate));
  }) || null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
