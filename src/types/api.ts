interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

interface MeResponse {
  user: User;
}

type WorkspaceRole = "owner" | "editor" | "commenter" | "viewer";

interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}

interface WorkspacesResponse {
  workspaces: Workspace[];
}

interface CreateWorkspaceResponse {
  workspace: Workspace;
}

interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface ApiErrorBody {
  statusCode: number;
  message: string;
}

export type {
  User,
  AuthResponse,
  MeResponse,
  WorkspaceRole,
  Workspace,
  WorkspacesResponse,
  CreateWorkspaceResponse,
  RegisterInput,
  LoginInput,
  ApiErrorBody,
};
