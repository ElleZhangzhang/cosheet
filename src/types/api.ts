import type { ColumnDef } from "@/types";

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

type MemberRole = "editor" | "commenter" | "viewer";

interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: string;
}

interface MembersResponse {
  members: WorkspaceMember[];
}

interface AddMemberInput {
  email: string;
  role: MemberRole;
}

interface UpdateMemberRoleInput {
  role: MemberRole;
}

interface MemberResponse {
  member: WorkspaceMember;
}
//#endregion

//#region comment
interface RowComment {
  id: string;
  versionId: string;
  rowIndex: number;
  columnKey: string | null;
  content: string;
  resolved: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
}

interface CommentsResponse {
  comments: RowComment[];
}

interface CreateCommentInput {
  versionId: string;
  rowIndex: number;
  columnKey?: string | null;
  content: string;
}

interface UpdateCommentInput {
  resolved: boolean;
}

interface CommentResponse {
  comment: RowComment;
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

// 文件版本详情
interface FileVersionDetail {
  id: string;
  versionNumber: number;
  baseVersionId: string | null;
  status: FileVersionStatus;
  columns: ColumnDef[];
  rowCount: number;
  chunkCount: number;
  createdAt: string;
  // 该版本被重新编辑的条数（被放进cell_edits的编辑条数）
  pendingEditCount: number;
}

interface FileDetailResponse {
  file: {
    id: string;
    workspaceId: string;
    name: string;
    latestVersionNumber: number;
    createdAt: string;
    updatedAt: string;
  };
  latestVersion: FileVersionDetail | null;
  versions: FileVersionDetail[];
}

interface VersionRow {
  id?: string;
  rowIndex: number;

  // 除了明确规定的id和rowIndex之外，这个接口还可以包含任意数量的其他属性（因为不同文件的column是不一样的）
  // 这些属性的key必须是字符串，value可以是任意类型
  [key: string]: unknown;
}

// rows查询
interface VersionRowsQuery {
  offset?: number;
  limit?: number;
  q?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

// rows查询的返回
interface VersionRowsResponse {
  rows: VersionRow[];
  total: number;
  offset: number;
  limit: number;
}

// 单元格编辑结果
interface VersionCell {
  rowIndex: number;
  columnKey: string;
  value: unknown;
  revision: number;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

interface UpdateVersionCellResponse {
  cell: VersionCell;
}

// 保留版本响应类型
interface RetainVersionResponse {
  version: {
    id: string;
    versionNumber: number;
    baseVersionId: string;
    status: "ready";
    rowCount: number;
    chunkCount: number;
  };
  file: {
    id: string;
    latestVersionNumber: number;
  };
}

interface ClearVersionEditsResponse {
  versionId: string;
  cleared: number;
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
  MemberRole,
  WorkspaceMember,
  MembersResponse,
  AddMemberInput,
  UpdateMemberRoleInput,
  MemberResponse,
  RowComment,
  CommentsResponse,
  CreateCommentInput,
  UpdateCommentInput,
  CommentResponse,
  FileVersionStatus,
  FileVersionSummary,
  FileSummary,
  FilesResponse,
  CreateFileResponse,
  FileVersionDetail,
  FileDetailResponse,
  VersionRow,
  VersionRowsQuery,
  VersionRowsResponse,
  VersionCell,
  UpdateVersionCellResponse,
  RetainVersionResponse,
  ClearVersionEditsResponse,
  UploadChunkResponse,
  UploadedChunkInfo,
  VersionChunksResponse,
  CompleteVersionResponse,
  RegisterInput,
  LoginInput,
  ApiErrorBody,
};
