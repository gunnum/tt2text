import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mmd", "text/plain; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

export async function serveFile(res, fullPath, { rootDir, req } = {}) {
  if (rootDir && !isPathInside(fullPath, rootDir)) {
    return json(res, 403, { error: "Forbidden" });
  }

  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      return json(res, 404, { error: "Not found" });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const type = mimeTypes.get(ext) || "application/octet-stream";
    const isHead = String(req?.method || "GET").toUpperCase() === "HEAD";
    const headers = {
      "Content-Type": type,
      "Cache-Control": "no-store, max-age=0",
      "Accept-Ranges": "bytes"
    };
    const rangeHeader = String(req?.headers?.range || "").trim();
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, stat.size);
      if (!range) {
        res.writeHead(416, {
          ...headers,
          "Content-Range": `bytes */${stat.size}`
        });
        res.end();
        return;
      }
      const chunkSize = range.end - range.start + 1;
      res.writeHead(206, {
        ...headers,
        "Content-Length": chunkSize,
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`
      });
      if (isHead) {
        res.end();
        return;
      }
      await pipeFileRange(res, fullPath, range.start, range.end);
      return;
    }

    res.writeHead(200, {
      ...headers,
      "Content-Length": stat.size
    });
    if (isHead) {
      res.end();
      return;
    }
    await pipeFileRange(res, fullPath);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

export function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求体不是有效 JSON。"));
      }
    });
    req.on("error", reject);
  });
}

export function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0"
  });
  res.end(html);
}

function isPathInside(targetPath, rootDir) {
  const relative = path.relative(rootDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseByteRange(value, size) {
  const match = value.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    const suffix = Number(end);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0 || start >= size) return null;
    if (end === null) {
      end = size - 1;
    } else if (!Number.isFinite(end) || end < start) {
      return null;
    } else {
      end = Math.min(end, size - 1);
    }
  }
  return { start, end };
}

function pipeFileRange(res, fullPath, start, end) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(fullPath, start === undefined ? undefined : { start, end });
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });
}
