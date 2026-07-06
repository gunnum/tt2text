import { spawn } from "node:child_process";

export function createArticleRunnerService(deps = {}) {
  const requiredDeps = [
    "articleRunner",
    "projectRootDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createArticleRunnerService 缺少依赖：${dep}`);
    }
  }

  function runArticleExtractor(articleUrl, bundleDir) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [deps.articleRunner, articleUrl, bundleDir], {
        cwd: deps.projectRootDir,
        env: deps.env || process.env
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `文章提取失败，退出码 ${code}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  return {
    runArticleExtractor
  };
}
