import {
  createAgentStatusService
} from "./agent-status-service.mjs";

export function createAgentServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAgentServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    env = process.env
  } = deps;
  const {
    projectRootDir,
    storageRootDir
  } = runtimeConfig.paths;
  const {
    port,
    binaries
  } = runtimeConfig;
  const {
    codexBin
  } = binaries;

  const agentStatusService = createAgentStatusService({
    projectRootDir,
    storageRootDir,
    port,
    codexBin,
    env
  });
  const { getAgentStatus } = agentStatusService;

  return {
    routeDeps: {
      getAgentStatus
    }
  };
}
