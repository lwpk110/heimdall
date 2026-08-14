import { Context } from "probot";
import { loadConfig } from "../config";
import { generateReview } from "./providers";
import { parseReview, renderMarkdown, ReviewResult } from "./parse";
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

  let rawReport: string;
  try {
    rawReport = await generateReview(config, {
      systemPrompt: SYSTEM_PROMPT,
      diff: patch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postSummary(context, renderReport(stats, `⚠️ 审查失败：${message}`));
    return;
  }

  const result = parseReview(rawReport);
  if (!result) {
    // 结构化解析失败：降级为整体报告，不静默丢失审查内容
    await postSummary(context, renderReport(stats, rawReport));
    return;
  }

  await postInlineReview(context, stats, result);
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

async function postInlineReview(
  context: Context<"pull_request">,
  stats: DiffStats,
  result: ReviewResult
): Promise<void> {
  const pr = context.pullRequest();
  const body = renderReport(stats, renderMarkdown(result));

  const comments = result.issues
    .filter((i) => i.line > 0)
    .map((i) => ({
      path: i.file,
      line: i.line,
      side: "RIGHT" as const,
      body: `**${severityLabel(i.severity)}** ${i.comment}`,
    }));

  if (comments.length === 0) {
    await postSummary(context, body);
    return;
  }

  try {
    await context.octokit.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      event: "COMMENT",
      body,
      comments,
    });
  } catch (err) {
    // 行号映射失败（GitHub 422 等）：降级为整体报告
    console.error("行内评论发布失败，降级为整体报告：", err instanceof Error ? err.message : err);
    await postSummary(context, body);
  }
}

function severityLabel(severity: "critical" | "important" | "normal"): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "important":
      return "🟡";
    case "normal":
      return "🟢";
  }
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
