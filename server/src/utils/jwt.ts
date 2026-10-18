import jwt from "jsonwebtoken";
import { HttpError } from "./httpError";

interface TokenUser {
  id: string;
  email: string;
}

interface TokenPayload {
  sub: string;
  email: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
}

// 签发token
export function signToken(user: TokenUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, getJwtSecret(), {
    expiresIn: "7d",
  });
}

// 校验token
export function verifyToken(token: string): TokenPayload {
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) {
      throw new Error("Invalid token payload");
    }

    return { sub: payload.sub, email: payload.email };
  } catch {
    throw new HttpError(401, "登录已失效");
  }
}
