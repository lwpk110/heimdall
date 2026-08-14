import { Probot } from "probot";
import { runReview } from "./review";
import { loadRepoConfigFromOctokit } from "./review/repo-config";

export function createApp(app: Probot): void {
  app.on(
    ["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"],
    async (context) => {
      const pr = context.payload.pull_request;

      // 跳过草稿 PR 与机器人发起的 PR，避免干扰
      if (pr.draft) return;
      if (pr.user?.type === "Bot") return;

      const owner = pr.base.repo.owner.login;
      const repo = pr.base.repo.name;
      const repoConfig = await loadRepoConfigFromOctokit(context.octokit, owner, repo);
      if (repoConfig.auto_review === false) {
        console.log("海姆达尔：auto_review 已关闭，跳过自动审查（可在 PR 评论发 @heimdall review 手动触发）");
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
    if (!/@heimdall(?:\s+review)?\b/i.test(payload.comment?.body ?? "")) return;
    if (payload.comment?.user?.type === "Bot") return; // 忽略机器人评论

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const repoConfig = await loadRepoConfigFromOctokit(context.octokit, owner, repo);
    if (!isAllowedManualReviewer(repoConfig.manual_reviewers, payload.comment?.user?.login)) {
      console.log(`海姆达尔：@${payload.comment?.user?.login} 不在 manual_reviewers 白名单，忽略触发`);
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
  return whitelist.some((name) => name.toLowerCase() === login.toLowerCase());
}
