import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = ".tmp/mindmaps";
const MARKMAP_AUTOFIT_URL = "https://cdn.jsdelivr.net/npm/markmap-autoloader@0.18.12";

const args = parseArgs(process.argv.slice(2));

async function main() {
  const input = args.input || args.i;
  if (!input) {
    throw new Error("缺少 --input <markdown-file>");
  }

  const inputPath = path.resolve(input);
  const markdown = await fs.readFile(inputPath, "utf8");
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR);
  const outputName = args.output
    ? path.resolve(args.output)
    : path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.html`);

  await fs.mkdir(path.dirname(outputName), { recursive: true });
  await fs.writeFile(outputName, buildHtml(markdown, inputPath), "utf8");

  process.stdout.write(`${outputName}\n`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function buildHtml(markdown, inputPath) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(path.basename(inputPath))} - 脑图</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: rgba(255, 252, 245, 0.88);
        --text: #221b16;
        --muted: #6e6258;
        --line: rgba(34, 27, 22, 0.1);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(219, 162, 83, 0.18), transparent 28%),
          radial-gradient(circle at bottom right, rgba(95, 154, 128, 0.16), transparent 24%),
          var(--bg);
        color: var(--text);
      }
      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr;
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        backdrop-filter: blur(10px);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .title {
        min-width: 0;
      }
      .title h1 {
        margin: 0;
        font-size: 16px;
        line-height: 1.35;
        font-weight: 600;
      }
      .title p {
        margin: 2px 0 0;
        color: var(--muted);
        font-size: 12px;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      button {
        border: 1px solid var(--line);
        background: #fffaf2;
        color: var(--text);
        border-radius: 999px;
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: #fff;
      }
      #mindmap {
        width: 100%;
        height: calc(100vh - 64px);
      }
      svg.markmap {
        width: 100%;
        height: 100%;
      }
      @media (max-width: 720px) {
        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }
        #mindmap {
          height: calc(100vh - 114px);
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="title">
          <h1>${escapeHtml(path.basename(inputPath, path.extname(inputPath)))}</h1>
          <p>${escapeHtml(inputPath)}</p>
        </div>
        <div class="actions">
          <button type="button" data-action="fit">适配画布</button>
          <button type="button" data-action="expand">全部展开</button>
          <button type="button" data-action="collapse">全部折叠</button>
        </div>
      </header>
      <svg id="mindmap"></svg>
    </div>

    <script type="text/template" id="mindmap-markdown">
${escapeTemplate(markdown)}
    </script>
    <script src="${MARKMAP_AUTOFIT_URL}"></script>
    <script>
      function waitForMarkmap() {
        return new Promise((resolve, reject) => {
          const startedAt = Date.now();
          (function poll() {
            if (window.markmap?.Transformer && window.markmap?.Markmap) {
              resolve(window.markmap);
              return;
            }
            if (Date.now() - startedAt > 10000) {
              reject(new Error("markmap 加载超时"));
              return;
            }
            setTimeout(poll, 60);
          })();
        });
      }

      function setFoldState(node, folded, keepRootExpanded = false, depth = 0) {
        node.payload = node.payload || {};
        node.payload.fold = keepRootExpanded && depth === 0 ? 0 : (folded ? 2 : 0);
        if (Array.isArray(node.children)) {
          node.children.forEach((child) => setFoldState(child, folded, keepRootExpanded, depth + 1));
        }
      }

      function depthOf(node) {
        let depth = 0;
        let current = node;
        while (current?.parent) {
          depth += 1;
          current = current.parent;
        }
        return depth;
      }

      function layoutExtraOffset(depth) {
        if (depth === 1) return 20;
        if (depth === 2) return 10;
        return 0;
      }

      function applyLevelSpacing(svg) {
        const nodeGroups = [...svg.querySelectorAll("g.markmap-node")];
        if (!nodeGroups.length) return;

        const nodeData = nodeGroups
          .map((group) => ({ group, datum: group.__data__ }))
          .filter((item) => item.datum && typeof item.datum.y === "number");

        const offsets = new Map();
        const levelBuckets = new Map();

        for (const item of nodeData) {
          const depth = depthOf(item.datum);
          const parent = item.datum.parent;
          const parentKey = parent ? String(depthOf(parent)) + ":" + String(parent.state?.id ?? parent.name ?? parent.t ?? "") : "root";
          const bucketKey = String(depth) + ":" + parentKey;
          if (!levelBuckets.has(bucketKey)) levelBuckets.set(bucketKey, []);
          levelBuckets.get(bucketKey).push(item);
        }

        for (const items of levelBuckets.values()) {
          items.sort((a, b) => a.datum.y - b.datum.y);
          let cumulative = 0;
          for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (index > 0) cumulative += layoutExtraOffset(depthOf(item.datum));
            offsets.set(item.datum, cumulative);
          }
        }

        for (const item of nodeData) {
          const offset = offsets.get(item.datum) || 0;
          const x = item.datum.x || 0;
          const y = (item.datum.y || 0) + offset;
          item.group.setAttribute("transform", "translate(" + x + "," + y + ")");
        }

        const links = [...svg.querySelectorAll("path.markmap-link")];
        for (const link of links) {
          const datum = link.__data__;
          if (!datum?.source || !datum?.target) continue;
          const sourceOffset = offsets.get(datum.source) || 0;
          const targetOffset = offsets.get(datum.target) || 0;
          const sourceX = datum.source.x || 0;
          const sourceY = (datum.source.y || 0) + sourceOffset;
          const targetX = datum.target.x || 0;
          const targetY = (datum.target.y || 0) + targetOffset;
          const midX = (sourceX + targetX) / 2;
          link.setAttribute("d", "M" + sourceX + "," + sourceY + "C" + midX + "," + sourceY + "," + midX + "," + targetY + "," + targetX + "," + targetY);
        }
      }

      async function start() {
        const { Transformer, Markmap } = await waitForMarkmap();
        const markdown = document.getElementById("mindmap-markdown").textContent;
        const transformer = new Transformer();
        const createRoot = () => transformer.transform(markdown).root;
        const svg = document.getElementById("mindmap");
        const mm = Markmap.create(svg, {
          autoFit: true,
          colorFreezeLevel: 2,
          duration: 200,
          fitRatio: 0.92,
          initialExpandLevel: 2,
          maxWidth: 320,
          paddingX: 20,
          scrollForPan: true,
          zoom: true
        }, createRoot());

        const refreshLayout = () => {
          requestAnimationFrame(() => {
            applyLevelSpacing(svg);
          });
        };

        refreshLayout();

        document.querySelector('[data-action="fit"]').addEventListener("click", () => mm.fit());
        document.querySelector('[data-action="expand"]').addEventListener("click", async () => {
          const nextRoot = createRoot();
          setFoldState(nextRoot, false, true);
          await mm.setData(nextRoot, { initialExpandLevel: -1 });
          mm.fit();
          refreshLayout();
        });
        document.querySelector('[data-action="collapse"]').addEventListener("click", async () => {
          const nextRoot = createRoot();
          setFoldState(nextRoot, true, true);
          await mm.setData(nextRoot, { initialExpandLevel: -1 });
          mm.fit();
          refreshLayout();
        });

        window.addEventListener("resize", refreshLayout);
      }

      start().catch((error) => {
        console.error(error);
        document.body.innerHTML = '<pre style="padding:24px;font-family:monospace;">' + error.message + '</pre>';
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeTemplate(value) {
  return String(value || "").replace(/<\/script>/gi, "<\\/script>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
