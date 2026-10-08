import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

function getModuleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function findFrontendDist(): string | null {
  const candidates: string[] = [];

  if (process.env.FRONTEND_DIST) {
    candidates.push(path.resolve(process.env.FRONTEND_DIST));
  }

  const moduleDir = getModuleDir();

  // Relative to module location (e.g. artifacts/api-server/src or artifacts/api-server/dist)
  candidates.push(path.resolve(moduleDir, "../../../artifacts/forwardcheck/dist/public"));
  candidates.push(path.resolve(moduleDir, "../../forwardcheck/dist/public"));
  candidates.push(path.resolve(moduleDir, "../forwardcheck/dist/public"));

  // Relative to process.cwd()
  candidates.push(path.resolve(process.cwd(), "artifacts/forwardcheck/dist/public"));
  candidates.push(path.resolve(process.cwd(), "../forwardcheck/dist/public"));
  candidates.push(path.resolve(process.cwd(), "../../artifacts/forwardcheck/dist/public"));

  for (const candidate of candidates) {
    const indexPath = path.join(candidate, "index.html");
    if (fs.existsSync(candidate) && fs.existsSync(indexPath)) {
      logger.info({ candidate }, "Serving frontend static build directory");
      return candidate;
    }
  }

  logger.warn(
    { cwd: process.cwd(), moduleDir, candidates },
    "Frontend dist directory containing index.html was not found in any expected candidate paths.",
  );
  return null;
}

const frontendDist = findFrontendDist();

if (frontendDist) {
  app.use(express.static(frontendDist));

  // Express 5 compatible SPA fallback for non-API GET routes
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      const indexPath = path.join(frontendDist, "index.html");
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
    }
    next();
  });
}

export default app;
