//#region auth
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

interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

interface LoginInput {
  email: string;
  password: string;
}
//#endregion

//#region workspace
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
//#endregion

//#region file
type FileVersionStatus = "uploading" | "ready";

interface FileVersionSummary {
  id: string;
  versionNumber: number;
  rowCount: number; // 总行数
  columnCount: number; // 总列数
  chunkCount: number; // 分片数
  status: FileVersionStatus;
}

interface FileSummary {
  id: string;
  name: string;
  latestVersionNumber: number;
  createdAt: string;
  updatedAt: string;
  version: FileVersionSummary | null;
}

interface FilesResponse {
  files: FileSummary[];
}

interface CreateFileResponse {
  file: {
    id: string;
    name: string;
    latestVersionNumber: number;
  };
  version: {
    id: string;
    versionNumber: number;
    status: FileVersionStatus;
    chunkCount: number;
  };
}
//#endregion

//#region chunk
interface UploadChunkResponse {
  chunk: {
    index: number;
    rowCount: number;
  };
}

interface UploadedChunkInfo {
  index: number;
  rowCount: number;
}

interface VersionChunksResponse {
  versionId: string;
  fileId: string;
  status: FileVersionStatus;
  rowCount: number;
  chunkCount: number;
  chunks: UploadedChunkInfo[];
}

interface CompleteVersionResponse {
  version: {
    id: string;
    versionNumber: number;
    status: FileVersionStatus;
    rowCount: number;
    chunkCount: number;
  };
  file: {
    id: string;
    latestVersionNumber: number;
  };
}
//#endregion

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
  FileVersionStatus,
  FileVersionSummary,
  FileSummary,
  FilesResponse,
  CreateFileResponse,
  UploadChunkResponse,
  UploadedChunkInfo,
  VersionChunksResponse,
  CompleteVersionResponse,
  RegisterInput,
  LoginInput,
  ApiErrorBody,
};
