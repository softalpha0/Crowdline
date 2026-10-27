import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { DataSource } from "./data.ts";

const PORT = Number(process.env.PORT ?? 8787);
const data = new DataSource(process.env);
const WEB_DIST = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");

createServer(createApp(data, WEB_DIST)).listen(PORT, () => {
  console.log(
    `crowdline server on http://localhost:${PORT} (${data.mode} crowd data, quotes ${data.hasApiKey ? "on" : "off: no ONECLICK_API_KEY"})`,
  );
});
