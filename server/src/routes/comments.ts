import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createComment,
  deleteComment,
  listComments,
  updateCommentResolved,
} from "../services/comments";
import { HttpError } from "../utils/httpError";
import {
  validateCommentListQuery,
  validateCreateCommentInput,
  validateUpdateCommentInput,
} from "../utils/validate";

export const fileCommentsRouter = Router({ mergeParams: true });
export const commentsRouter = Router();

function getCurrentUserId(userId: string | undefined): string {
  if (!userId) {
    throw new HttpError(401, "未登录");
  }

  return userId;
}

function getFileId(fileId: string | string[] | undefined): string {
  if (typeof fileId !== "string" || !fileId) {
    throw new HttpError(400, "缺少文件 ID");
  }

  return fileId;
}

function getCommentId(
  commentId: string | string[] | undefined
): string {
  if (typeof commentId !== "string" || !commentId) {
    throw new HttpError(400, "缺少评论 ID");
  }

  return commentId;
}

// GET /api/files/:fileId/comments?versionId=...
fileCommentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { versionId } = validateCommentListQuery(
      req.query as Record<string, unknown>
    );

    const comments = await listComments(
      getCurrentUserId(req.userId),
      getFileId(req.params.fileId),
      versionId
    );

    res.json({ comments });
  })
);

// POST /api/files/:fileId/comments
fileCommentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = validateCreateCommentInput(req.body);

    const comment = await createComment(
      getCurrentUserId(req.userId),
      getFileId(req.params.fileId),
      input
    );

    res.status(201).json({ comment });
  })
);

// PATCH /api/comments/:commentId
commentsRouter.patch(
  "/:commentId",
  asyncHandler(async (req, res) => {
    const input = validateUpdateCommentInput(req.body);

    const comment = await updateCommentResolved(
      getCurrentUserId(req.userId),
      getCommentId(req.params.commentId),
      input.resolved
    );

    res.json({ comment });
  })
);

// DELETE /api/comments/:commentId
commentsRouter.delete(
  "/:commentId",
  asyncHandler(async (req, res) => {
    await deleteComment(
      getCurrentUserId(req.userId),
      getCommentId(req.params.commentId)
    );

    res.status(204).send();
  })
);
