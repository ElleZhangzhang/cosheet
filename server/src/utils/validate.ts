// 说明：后端初步校验前端POST的register/login信息的格式是否合法

import { HttpError } from "./httpError";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface CreateWorkspaceInput {
  name: string;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "请求体格式不正确");
  }
  return body as Record<string, unknown>;
}

function validateEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "邮箱不能为空");
  }

  const email = value.trim().toLowerCase();
  if (email.length > 255 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, "邮箱格式不正确");
  }

  return email;
}

function validateRegisterPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(400, "密码至少 8 位");
  }

  return value;
}

function validateLoginPassword(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "密码不能为空");
  }

  return value;
}

function validateName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new HttpError(400, "姓名不能为空");
  }
  if (name.length > 100) {
    throw new HttpError(400, "姓名不能超过 100 个字符");
  }

  return name;
}

// HACK_RESOLVED try-catch throw
// 解决：有路由中间件兜底

// 初步校验注册信息（name/email/password）格式合法
export function validateRegisterInput(body: unknown): RegisterInput {
  const data = asObject(body);

  return {
    email: validateEmail(data.email),
    password: validateRegisterPassword(data.password),
    name: validateName(data.name),
  };
}

// 初步校验登录信息（name/email/password）格式合法
export function validateLoginInput(body: unknown): LoginInput {
  const data = asObject(body);

  return {
    email: validateEmail(data.email),
    password: validateLoginPassword(data.password),
  };
}

// 校验工作空间名称：去空格后 1–200 字符
function validateWorkspaceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new HttpError(400, "工作空间名称不能为空");
  }
  if (name.length > 200) {
    throw new HttpError(400, "工作空间名称不能超过 200 个字符");
  }

  return name;
}

// 初步校验创建工作空间时的请求体（是不是对象？空间名称对不对？）
export function validateCreateWorkspaceInput(
  body: unknown
): CreateWorkspaceInput {
  const data = asObject(body);

  return {
    name: validateWorkspaceName(data.name),
  };
}
