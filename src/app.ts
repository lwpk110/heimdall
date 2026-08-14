import { Probot } from "probot";
import { runReview } from "./review";

export function createApp(app: Probot): void {
  app.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"],
    async (context) => {
      const pr = context.payload.pull_request;

      // 跳过草稿 PR 与机器人发起的 PR，避免干扰
      if (pr.draft) return;
      if (pr.user?.type === "Bot") return;

      await runReview({
        octokit: context.octokit,
        owner: pr.base.repo.owner.login,
        repo: pr.base.repo.name,
        pullNumber: pr.number,
      });
    }
  );

  // 按需审查：在 PR 评论里发 @heimdall review 手动触发重新审查
  app.on("issue_comment.created", async (context) => {
    const payload = context.payload;
    if (!payload.issue?.pull_request) return; // 只处理 PR 上的评论
    if (!/@heimdall\s+review/i.test(payload.comment?.body ?? "")) return;
    if (payload.comment?.user?.type === "Bot") return; // 忽略机器人评论

    await runReview({
      octokit: context.octokit,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pullNumber: payload.issue.number,
    });
  });
}
