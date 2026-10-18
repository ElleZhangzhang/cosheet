import cors from "cors";
import express from "express";
import { authRequired } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { filesRouter } from "./routes/files";
import { versionsRouter } from "./routes/versions";
import { workspacesRouter } from "./routes/workspaces";

export function createApp() {
  const app = express();

  // 后端通过配置CORS响应头设置允许跨域
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use(
    "/api/workspaces/:workspaceId/files",
    authRequired,
    filesRouter
  );
  app.use("/api/versions", authRequired, versionsRouter);
  app.use("/api/workspaces", authRequired, workspacesRouter);

  // 成功的请求在前面就处理完返回了，走不到这两步。
  // 把它们写在最后，就是为了“捡漏”和“兜底”
  app.use(notFoundHandler); // 比如/api/haha会被它捡漏
  app.use(errorHandler); // 比如/api/health内部主动抛出错误，会跳到这里被它兜底

  return app;
}
