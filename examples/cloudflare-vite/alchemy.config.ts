import { $, alchemize } from "../../src";
import { StaticSite, Worker } from "../../src/cloudflare";
import { DurableObjectNamespace } from "../../src/cloudflare/durable-object-namespace";

import "dotenv/config";

const counter = new DurableObjectNamespace("COUNTER", {
  bindingName: "COUNTER",
  className: "Counter",
  sqlite: true,
});

const api = new Worker("api", {
  name: "alchemy-example-vite-api",
  entrypoint: "./src/index.ts",
  bindings: [counter],
});

const website = new StaticSite("Website", {
  name: "alchemy-example-vite",
  dir: "./dist",
  build: {
    command: "bun run build",
  },
  routes: {
    "/api/*": api,
  },
});

$(console).log({
  url: website.url,
});

await alchemize({
  mode: process.argv.includes("--destroy") ? "destroy" : "up",
  quiet: process.argv.includes("--verbose") ? false : true,
});
