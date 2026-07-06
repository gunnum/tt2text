import {
  json,
  readJsonBody
} from "../http-utils.mjs";

export function assertRouteDeps(factoryName, deps, requiredDeps) {
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`${factoryName} 缺少依赖：${dep}`);
    }
  }
}

export function sendJson(res, statusCode, payload) {
  json(res, statusCode, payload);
  return true;
}

export async function dispatchRoutes(req, res, url, routes) {
  for (const route of routes) {
    if (route.method !== req.method) {
      continue;
    }

    const matchResult = route.match(url, req);
    if (!matchResult) {
      continue;
    }

    await route.handle({ req, res, url, match: matchResult });
    return true;
  }

  return false;
}

export async function dispatchRouteHandlers(req, res, url, handlers) {
  for (const handleRoute of handlers) {
    if (await handleRoute(req, res, url)) {
      return true;
    }
  }

  return false;
}

export function createRouteHandlerFactory(factoryName, requiredDeps, buildRoutes) {
  return function createRouteHandler(deps = {}) {
    assertRouteDeps(factoryName, deps, requiredDeps);
    const routes = buildRoutes(deps);
    return async function handleRoutes(req, res, url) {
      return dispatchRoutes(req, res, url, routes);
    };
  };
}

export function withRouteBody(action) {
  return async function handleWithRouteBody(context) {
    const body = await readRouteBody(context.req);
    return action({ ...context, body });
  };
}

export function withRequiredString(fieldName, errorMessage, action, options = {}) {
  return async function handleWithRequiredString(context) {
    const result = readRequiredString(context.body, fieldName, errorMessage, options);
    if (!result.ok) {
      return sendJson(context.res, 400, { error: errorMessage });
    }

    const injectedFieldName = options.as || fieldName;
    return action({ ...context, [injectedFieldName]: result.value });
  };
}

export function withStringIdList(action, { fieldName = "ids", errorMessage } = {}) {
  return async function handleWithStringIdList(context) {
    const result = readStringIdList(context.body, fieldName);
    if (!result.ok) {
      return sendJson(context.res, 400, { error: errorMessage || "缺少有效的删除 id 列表。" });
    }

    return action({ ...context, ids: result.ids });
  };
}

export function exactPath(pathname) {
  return (url) => url.pathname === pathname;
}

export function prefixPath(pathPrefix) {
  return (url) => url.pathname.startsWith(pathPrefix);
}

export async function readRouteBody(req) {
  return readJsonBody(req);
}

export function sendValidationError(res, message) {
  return sendJson(res, 400, { error: message });
}

export function readRequiredString(body, fieldName, errorMessage, { trim = false } = {}) {
  if (!body?.[fieldName] || typeof body[fieldName] !== "string") {
    return { ok: false, errorMessage };
  }

  return {
    ok: true,
    value: trim ? body[fieldName].trim() : body[fieldName]
  };
}

export function readStringIdList(body, fieldName = "ids") {
  const ids = body?.[fieldName];
  if (!hasOnlyStringIds(ids)) {
    return { ok: false };
  }

  return {
    ok: true,
    ids
  };
}

export function decodePathSuffix(pathname, prefixPattern) {
  return decodeURIComponent(pathname.replace(prefixPattern, ""));
}

export function hasOnlyStringIds(ids) {
  return Array.isArray(ids) && !ids.some((id) => typeof id !== "string");
}
