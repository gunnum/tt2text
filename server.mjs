import { createServer } from "node:http";
import {
  createApplicationServices
} from "./server/application-services.mjs";
import {
  createHttpRouter
} from "./server/router-service.mjs";
import {
  createRuntimeConfig
} from "./server/runtime-config.mjs";

const runtimeConfig = createRuntimeConfig(import.meta.url, process.env);
const applicationServices = createApplicationServices({
  runtimeConfig,
  env: process.env,
  logger: console
});

await applicationServices.bootstrap();

const handleRequest = createHttpRouter(applicationServices.routeDeps);
const server = createServer(handleRequest);

server.listen(runtimeConfig.port, () => {
  console.log(`tt2text listening on http://localhost:${runtimeConfig.port}`);
});
