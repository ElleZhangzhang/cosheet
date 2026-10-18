// 说明：扩展 Express.Request，增加 userId

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export { };
