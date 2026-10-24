import { request } from "@/api/http";
import type {
  AddMemberInput,
  MemberResponse,
  MembersResponse,
  UpdateMemberRoleInput,
} from "@/types/api";

function listMembers(workspaceId: string): Promise<MembersResponse> {
  return request<MembersResponse>(
    `/workspaces/${workspaceId}/members`
  );
}

function addMember(
  workspaceId: string,
  input: AddMemberInput
): Promise<MemberResponse> {
  return request<MemberResponse>(
    `/workspaces/${workspaceId}/members`,
    {
      method: "POST",
      body: input,
    }
  );
}

function updateMemberRole(
  workspaceId: string,
  userId: string,
  input: UpdateMemberRoleInput
): Promise<MemberResponse> {
  return request<MemberResponse>(
    `/workspaces/${workspaceId}/members/${userId}`,
    {
      method: "PATCH",
      body: input,
    }
  );
}

function removeMember(
  workspaceId: string,
  userId: string
): Promise<null> {
  return request<null>(
    `/workspaces/${workspaceId}/members/${userId}`,
    {
      method: "DELETE",
    }
  );
}

export {
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
};
