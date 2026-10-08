import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] || "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = "0.0.0.0";

app.listen(port, host, () => {
  logger.info({ port, host }, "Server listening");
});
