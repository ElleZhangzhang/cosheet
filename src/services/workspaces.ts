import { request } from "@/api/http";
import type {
  CreateWorkspaceResponse,
  WorkspacesResponse,
} from "@/types/api";

function listWorkspaces(): Promise<WorkspacesResponse> {
  return request<WorkspacesResponse>("/workspaces");
}

function createWorkspace(name: string): Promise<CreateWorkspaceResponse> {
  return request<CreateWorkspaceResponse>("/workspaces", {
    method: "POST",
    body: { name },
  });
}

export { listWorkspaces, createWorkspace };
