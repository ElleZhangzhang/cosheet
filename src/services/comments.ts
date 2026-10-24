import { request } from "@/api/http";
import type {
  CommentResponse,
  CommentsResponse,
  CreateCommentInput,
} from "@/types/api";

function listComments(
  fileId: string,
  versionId: string
): Promise<CommentsResponse> {
  const params = new URLSearchParams({ versionId });

  return request<CommentsResponse>(
    `/files/${fileId}/comments?${params.toString()}`
  );
}

function createComment(
  fileId: string,
  input: CreateCommentInput
): Promise<CommentResponse> {
  return request<CommentResponse>(
    `/files/${fileId}/comments`,
    {
      method: "POST",
      body: input,
    }
  );
}

function updateComment(
  commentId: string,
  resolved: boolean
): Promise<CommentResponse> {
  return request<CommentResponse>(`/comments/${commentId}`, {
    method: "PATCH",
    body: { resolved },
  });
}

function deleteComment(commentId: string): Promise<null> {
  return request<null>(`/comments/${commentId}`, {
    method: "DELETE",
  });
}

export {
  listComments,
  createComment,
  updateComment,
  deleteComment,
};
