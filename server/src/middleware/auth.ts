import type { RequestHandler } from "express";
import { HttpError } from "../utils/httpError";
import { verifyToken } from "../utils/jwt";

// FIND next是啥
// Express 收到带参数的 next(error) 时，会直接跳过后面所有的正常业务中间件，把错误一路向后传递，直到被最后的Express全局错误处理中间件捕获（就是我们写的/middleware/error.ts）
export const authRequired: RequestHandler = (req, _res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    next(new HttpError(401, "未登录"));
    return;
  }

  const token = authorization.slice(7).trim();
  if (!token) {
    next(new HttpError(401, "未登录"));
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch (error) {
    next(error);
  }
};
