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

interface FileColumnInput {
  keyName: string;
  label: string;
  type: "number" | "date" | "string";
  width: number;
}

interface CreateFileInput {
  name: string;
  columns: FileColumnInput[];
  rowCount: number;
}

// 用来校验请求体body是object
function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "请求体格式不正确");
  }
  return body as Record<string, unknown>;
}

// #region 1.auth相关校验
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
//#endregion

// #region 2.workspace相关校验
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
//#endregion

//#region 3.file相关校验
// 校验单列定义
function validateColumnInput(
  value: unknown,
  index: number
): FileColumnInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `第 ${index + 1} 列格式不正确`);
  }

  const column = value as Record<string, unknown>;

  // 分别拿到该列（指单列）的keyName/label/type/width并校验是否合法
  const keyName =
    typeof column.keyName === "string" ? column.keyName.trim() : "";
  const label = typeof column.label === "string" ? column.label.trim() : "";

  if (!keyName || keyName.length > 255) {
    throw new HttpError(400, `第 ${index + 1} 列的 keyName 不合法`);
  }
  if (!label || label.length > 255) {
    throw new HttpError(400, `第 ${index + 1} 列的 label 不合法`);
  }

  const type = column.type;
  if (type !== "number" && type !== "date" && type !== "string") {
    throw new HttpError(400, `第 ${index + 1} 列的 type 不合法`);
  }

  const width = column.width;
  // Number.isFinite(width)：校验width是否为无限数(NaN/Infinity)，是则true，否则false
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    throw new HttpError(400, `第 ${index + 1} 列的 width 不合法`);
  }

  return { keyName, label, type, width };
}

// 校验文件名
function validateFileName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new HttpError(400, "文件名不能为空");
  }
  if (name.length > 255) {
    throw new HttpError(400, "文件名不能超过 255 个字符");
  }

  return name;
}

// 校验行数
function validateRowCount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new HttpError(400, "rowCount 必须是大于 0 的整数");
  }

  return value;
}

// 初步校验创建文件时的请求体
export function validateCreateFileInput(body: unknown): CreateFileInput {
  const data = asObject(body);

  if (!Array.isArray(data.columns) || data.columns.length === 0) {
    throw new HttpError(400, "columns 不能为空");
  }

  const columns = data.columns.map((column, index) =>
    validateColumnInput(column, index)
  );

  return {
    name: validateFileName(data.name),
    columns,
    rowCount: validateRowCount(data.rowCount),
  };
}
//#endregion

export type { FileColumnInput, CreateFileInput };
