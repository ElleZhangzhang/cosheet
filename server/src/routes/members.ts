import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "../services/members";
import { HttpError } from "../utils/httpError";
import {
  validateAddMemberInput,
  validateUpdateMemberRoleInput,
} from "../utils/validate";

export const membersRouter = Router({ mergeParams: true });

function getCurrentUserId(userId: string | undefined): string {
  if (!userId) {
    throw new HttpError(401, "未登录");
  }

  return userId;
}

function getWorkspaceId(
  workspaceId: string | string[] | undefined
): string {
  if (typeof workspaceId !== "string" || !workspaceId) {
    throw new HttpError(400, "缺少工作空间 ID");
  }

  return workspaceId;
}

function getTargetUserId(
  userId: string | string[] | undefined
): string {
  if (typeof userId !== "string" || !userId) {
    throw new HttpError(400, "缺少成员用户 ID");
  }

  return userId;
}

// GET /api/workspaces/:workspaceId/members
membersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const members = await listWorkspaceMembers(
      getCurrentUserId(req.userId),
      getWorkspaceId(req.params.workspaceId)
    );

    res.json({ members });
  })
);

// POST /api/workspaces/:workspaceId/members
membersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = validateAddMemberInput(req.body);

    const member = await addWorkspaceMember(
      getCurrentUserId(req.userId),
      getWorkspaceId(req.params.workspaceId),
      input.email,
      input.role
    );

    res.status(201).json({ member });
  })
);

// KNOW post/put/patch的区别
// 1. post 创建
// 2. put 全量替换
// 3. patch 局部更新
// 那么它们的幂等性如何？（连续发10次请求，第一次和第十次的结果一样吗？）
// 1. post 非幂等，连续发10次请求，就会创建10个不同的订单
// 2. put 幂等，连续发10次请求，每次都用同样的数据覆盖，最终结果完全一样
// 3. patch 取决于如何更新，连续发10次请求，每次更新都相同则为幂等，不同则非幂等

// PATCH /api/workspaces/:workspaceId/members/:userId
membersRouter.patch(
  "/:userId",
  asyncHandler(async (req, res) => {
    const input = validateUpdateMemberRoleInput(req.body);

    const member = await updateWorkspaceMemberRole(
      getCurrentUserId(req.userId),
      getWorkspaceId(req.params.workspaceId),
      getTargetUserId(req.params.userId),
      input.role
    );

    res.json({ member });
  })
);

// DELETE /api/workspaces/:workspaceId/members/:userId
membersRouter.delete(
  "/:userId",
  asyncHandler(async (req, res) => {
    await removeWorkspaceMember(
      getCurrentUserId(req.userId),
      getWorkspaceId(req.params.workspaceId),
      getTargetUserId(req.params.userId)
    );

    res.status(204).send();
  })
);
