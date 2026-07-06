import path from "node:path";
import { promises as fs } from "node:fs";
import { serveFile } from "../http-utils.mjs";
import {
  createRouteHandlerFactory,
  exactPath,
  prefixPath
} from "./route-utils.mjs";

export const staticRouteDeps = [
  "projectRootDir",
  "publicDir",
  "storageRootDir",
  "resolvePublicPathToFile"
];

export const createStaticRoutes = createRouteHandlerFactory("createStaticRoutes", staticRouteDeps, (deps) => {
  const {
    projectRootDir,
    publicDir,
    storageRootDir,
    resolvePublicPathToFile
  } = deps;

  const serveProjectFile = async ({ req, res, url }) => {
    const pathname = decodeStaticPathname(url.pathname);
    const filePath = resolvePublicPathToFile(pathname);
    await serveFile(res, filePath, { rootDir: storageRootDir || projectRootDir, req });
    return true;
  };

  return [
    {
      method: "GET",
      match: prefixPath("/data/"),
      handle: serveProjectFile
    },
    {
      method: "HEAD",
      match: prefixPath("/data/"),
      handle: serveProjectFile
    },
    {
      method: "GET",
      match: prefixPath("/sensor/"),
      handle: serveProjectFile
    },
    {
      method: "HEAD",
      match: prefixPath("/sensor/"),
      handle: serveProjectFile
    },
    {
      method: "GET",
      match: prefixPath("/reports/"),
      handle: serveProjectFile
    },
    {
      method: "HEAD",
      match: prefixPath("/reports/"),
      handle: serveProjectFile
    },
    {
      method: "GET",
      match: (url) => ["/production", "/production/", "/production/reports", "/production/reports/"].includes(url.pathname),
      handle: async ({ res }) => {
        res.writeHead(302, {
          Location: "/reports",
          "Cache-Control": "no-store, max-age=0"
        });
        res.end();
        return true;
      }
    },
    {
      method: "GET",
      match: () => true,
      handle: async ({ req, res, url }) => {
        const target = await resolveStaticTarget(publicDir, url.pathname);
        await serveFile(res, path.join(publicDir, target), { rootDir: projectRootDir, req });
        return true;
      }
    }
  ];
});

function decodeStaticPathname(pathname) {
  try {
    return decodeURIComponent(String(pathname || ""));
  } catch {
    return String(pathname || "");
  }
}

async function resolveStaticTarget(publicDir, pathname) {
  const clean = String(pathname || "/");
  if (clean === "/") {
    return "/index.html";
  }
  if (clean.endsWith("/")) {
    return `${clean}index.html`;
  }
  const lastSegment = clean.split("/").filter(Boolean).pop() || "";
  if (!lastSegment.includes(".")) {
    const nestedIndex = `${clean}/index.html`;
    if (await fileExists(path.join(publicDir, nestedIndex))) {
      return nestedIndex;
    }
    return `${clean}.html`;
  }
  return clean;
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
