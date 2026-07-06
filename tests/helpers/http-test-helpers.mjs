import { EventEmitter } from "node:events";

export function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    writableEnded: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk = "") {
      this.body += chunk;
      this.writableEnded = true;
    }
  };
}

export function createJsonRequest(method, url, payload) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  queueMicrotask(() => {
    if (payload !== undefined) {
      req.emit("data", Buffer.from(JSON.stringify(payload)));
    }
    req.emit("end");
  });
  return req;
}

export function createRouteUrl(pathname) {
  return new URL(pathname, "http://localhost:3000");
}

export async function runRoute(handler, { method, pathname, payload }) {
  const req = createJsonRequest(method, pathname, payload);
  const res = createResponseRecorder();
  await handler(req, res, createRouteUrl(pathname));
  return res;
}

export function readJsonResponse(res) {
  return JSON.parse(res.body);
}
