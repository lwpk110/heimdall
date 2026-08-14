import { Context } from "probot";
import { loadConfig } from "../config";
import { generateReview } from "./providers";
import { SYSTEM_PROMPT } from "./prompt";

export async function runReview(context: Context<"pull_request">): Promise<void> {
  const config = loadConfig();
  const pr = context.pullRequest();

  const { data: files } = await context.octokit.pulls.listFiles({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
    per_page: 100,
  });

  const stats = diffStats(files);
  const patch = files
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\``)
    .join("\n\n")
    .slice(0, config.maxDiffLength);

  if (!patch.trim()) {
    await postSummary(
      context,
      renderReport(stats, "海姆达尔：本次 PR 没有可审查的代码变更。")
    );
    return;
  }

  let report: string;
  try {
    report = await generateReview(config, {
      systemPrompt: SYSTEM_PROMPT,
      diff: patch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postSummary(context, renderReport(stats, `⚠️ 审查失败：${message}`));
    return;
  }

  await postSummary(context, renderReport(stats, report));
}

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

function diffStats(files: Array<{ additions?: number; deletions?: number }>): DiffStats {
  return {
    files: files.length,
    additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
    deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
  };
}

function renderReport(stats: DiffStats, content: string): string {
  return `## 海姆达尔 · 代码审查报告

**变更摘要**：本次 PR 共改动 ${stats.files} 个文件，+${stats.additions} / -${stats.deletions} 行。

${content}`;
}

async function postSummary(context: Context<"pull_request">, body: string): Promise<void> {
  const pr = context.pullRequest();
  await context.octokit.pulls.createReview({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
    event: "COMMENT",
    body,
  });
}
