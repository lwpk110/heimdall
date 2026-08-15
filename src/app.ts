import { Probot } from "probot";
import { createObserver, newReviewId, resolveObserverOptions } from "./observability";
import { applyRepoObservability, runReview } from "./review";
import { loadRepoConfigFromOctokit } from "./review/repo-config";

export function createApp(app: Probot): void {
  app.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"],
    async (context) => {
      const pr = context.payload.pull_request;

      const obs = createObserver(resolveObserverOptions("probot", process.env)).child({
        repo: `${pr.base.repo.owner.login}/${pr.base.repo.name}`,
        pr: pr.number,
        sha: pr.head?.sha,
        reviewId: newReviewId(),
        trigger: "auto",
      });

      // 跳过草稿 PR 与机器人发起的 PR，避免干扰
      if (pr.draft) {
        obs.invocation("review.skip", "草稿 PR，跳过审查", { reason: "draft_pr" });
        return;
      }
      if (pr.user?.type === "Bot") {
        obs.invocation("review.skip", "机器人发起的 PR，跳过审查", { reason: "bot_pr" });
        return;
      }

      const owner = pr.base.repo.owner.login;
      const repo = pr.base.repo.name;
      const repoConfig = await loadRepoConfigFromOctokit(context.octokit, owner, repo);
      if (repoConfig.auto_review !== true) {
        applyRepoObservability(obs, repoConfig).invocation(
          "review.skip",
          "默认仅按需审查，跳过自动审查（可在 PR 评论发 @CoderHeimdall 手动触发；配置 auto_review: true 开启自动）",
          { reason: "not_auto_review" }
        );
        return;
      }

      await runReview({
        octokit: context.octokit,
        owner,
        repo,
        pullNumber: pr.number,
        headSha: pr.head.sha,
        dedupe: true,
      });
    }
  );

  // 按需审查：在 PR 评论里发 @heimdall review 手动触发重新审查
  app.on("issue_comment.created", async (context) => {
    const payload = context.payload;
    if (!payload.issue?.pull_request) return; // 只处理 PR 上的评论
    if (!/@(?:coder)?heimdall(?:\s+review)?\b/i.test(payload.comment?.body ?? "")) return;
    if (payload.comment?.user?.type === "Bot") return; // 忽略机器人评论

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const obs = createObserver(resolveObserverOptions("probot", process.env)).child({
      repo: `${owner}/${repo}`,
      pr: payload.issue.number,
      reviewId: newReviewId(),
      trigger: "manual",
    });
    const repoConfig = await loadRepoConfigFromOctokit(context.octokit, owner, repo);
    if (!isAllowedManualReviewer(repoConfig.manual_reviewers, payload.comment?.user?.login)) {
      applyRepoObservability(obs, repoConfig).invocation(
        "review.skip",
        `@${payload.comment?.user?.login} 不在 manual_reviewers 白名单，忽略触发`,
        { reason: "reviewer_not_whitelisted", author: payload.comment?.user?.login }
      );
      return;
    }

    // 手动触发始终重新审查；取 head SHA 供 block_on_critical 状态使用
    const { data: pr } = await context.octokit.pulls.get({
      owner,
      repo,
      pull_number: payload.issue.number,
    });
    await runReview({
      octokit: context.octokit,
      owner,
      repo,
      pullNumber: payload.issue.number,
      headSha: pr.head.sha,
    });
  });
}

function isAllowedManualReviewer(whitelist: string[] | undefined, login: string | undefined): boolean {
  // 未配置白名单表示不限；白名单为空数组时同样放开
  if (!whitelist || whitelist.length === 0) return true;
  if (!login) return false;
  const cleanLogin = login.replace(/^@/, "").trim().toLowerCase();
  return whitelist.some((name) => name.replace(/^@/, "").trim().toLowerCase() === cleanLogin);
}
