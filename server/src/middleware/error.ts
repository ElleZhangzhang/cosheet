// 说明：全局处理中间件，捕获前面中间件 next(错误) 的错误

import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../utils/httpError";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ statusCode: 404, message: "接口不存在" });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res
      .status(error.statusCode)
      .json({ statusCode: error.statusCode, message: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ statusCode: 500, message: "服务器内部错误" });
};
