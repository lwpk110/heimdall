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

      await runReview(context);
    }
  );
}
