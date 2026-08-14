export type Severity = "critical" | "important" | "normal";

export interface ReviewIssue {
  severity: Severity;
  file: string;
  /** 新文件行号；0 表示无法定位，仅进报告不生成行内评论 */
  line: number;
  comment: string;
}

export interface ReviewResult {
  summary: string;
  issues: ReviewIssue[];
}

const SEVERITIES: Severity[] = ["critical", "important", "normal"];

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "🔴 严重问题",
  important: "🟡 建议改进",
  normal: "🟢 良好实践",
};

/** 解析 LLM 输出的结构化 JSON；失败返回 null（调用方降级为整体报告，不静默丢失） */
export function parseReview(raw: string): ReviewResult | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const obj = data as { summary?: unknown; issues?: unknown };
  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .map(normalizeIssue)
        .filter((i): i is ReviewIssue => i !== null)
    : [];

  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    issues,
  };
}

function normalizeIssue(raw: unknown): ReviewIssue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const severity = SEVERITIES.includes(item.severity as Severity)
    ? (item.severity as Severity)
    : "important";
  const file = typeof item.file === "string" ? item.file.trim() : "";
  const comment = typeof item.comment === "string" ? item.comment.trim() : "";
  const line = typeof item.line === "number" ? Math.floor(item.line) : 0;
  if (!file || !comment) return null;
  return { severity, file, line: line > 0 ? line : 0, comment };
}

/** 把结构化结果渲染为 markdown 报告（不含头部统计行） */
export function renderMarkdown(result: ReviewResult): string {
  const { summary, issues } = result;
  const lines: string[] = [];
  if (summary) lines.push(`**变更概述**：${summary}`, "");
  for (const sev of SEVERITIES) {
    const group = issues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${SEVERITY_LABELS[sev]}`, "");
    for (const i of group) {
      const loc = i.file + (i.line > 0 ? `:${i.line}` : "");
      lines.push(`- \`${loc}\`：${i.comment}`);
    }
    lines.push("");
  }
  if (issues.length === 0) {
    lines.push("未发现明显问题。", "");
  }
  return lines.join("\n").trim();
}
