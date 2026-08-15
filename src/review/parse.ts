export type Severity = "critical" | "important" | "normal";

export interface ReviewIssue {
  severity: Severity;
  file: string;
  /** 新文件行号；0 表示无法定位，仅进报告不生成行内评论 */
  line: number;
  /** 问题描述：说明问题与影响 */
  comment: string;
  /** 具体修复建议（可选，可含改法/代码思路） */
  suggestion?: string;
  /** 具体代码修改建议（可选，diff 格式，- 删 / + 增） */
  diff?: string;
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

/** 解析 LLM 输出的结构化 JSON；多策略提取候选，失败返回 null（调用方降级为整体报告，不静默丢失） */
export function parseReview(raw: string): ReviewResult | null {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = parseLooseJson(candidate);
      const result = normalizeResult(parsed);
      if (result) return result;
    } catch {
      // 该候选解析失败，尝试下一个
    }
  }
  return null;
}

/** 宽松 JSON 解析：修复字符串字面量中的未转义换行（LLM 输出常见），其余严格 */
function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    let out = "";
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") {
          out += c + (text[i + 1] ?? "");
          i++;
          continue;
        }
        if (c === '"') inStr = false;
        if (c === "\n" || c === "\r") {
          out += "\\n";
          continue;
        }
        out += c;
      } else {
        if (c === '"') inStr = true;
        out += c;
      }
    }
    return JSON.parse(out);
  }
}

function extractJsonCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const text = raw.trim();

  // 1. 去掉 markdown 围栏后整体作为候选
  candidates.push(text.replace(/```(?:json)?/gi, "").trim());

  // 2. 提取 ```json ... ``` 代码块内的完整内容
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text))) candidates.push(m[1].trim());

  // 3. 从第一个 { 到最后一个 } 截取（容忍前后杂讯）
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  return candidates;
}

function normalizeResult(data: unknown): ReviewResult | null {
  if (typeof data !== "object" || data === null) return null;
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
  const suggestion = typeof item.suggestion === "string" ? item.suggestion.trim() : "";
  const diff = typeof item.diff === "string" ? item.diff.trim() : "";
  if (!file || !comment) return null;
  const issue: ReviewIssue = {
    severity,
    file,
    line: line > 0 ? line : 0,
    comment,
  };
  if (suggestion) issue.suggestion = suggestion;
  if (diff) issue.diff = diff;
  return issue;
}

/** 把结构化结果渲染为 markdown 报告（不含头部统计行，含折叠块） */
export function renderMarkdown(result: ReviewResult): string {
  const { summary, issues } = result;
  const lines: string[] = [];
  if (summary) lines.push(`**变更概述**：${summary}`, "");
  if (issues.length > 0) {
    const critical = issues.filter((i) => i.severity === "critical").length;
    const important = issues.filter((i) => i.severity === "important").length;
    const normal = issues.filter((i) => i.severity === "normal").length;
    lines.push(`🔍 **发现 ${issues.length} 个问题**（critical ${critical} / important ${important} / normal ${normal}）`, "");
  }
  lines.push("<details>", "<summary>🤖 审查评论</summary>", "");
  for (const sev of SEVERITIES) {
    const group = issues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${SEVERITY_LABELS[sev]}`, "");
    for (const i of group) {
      const loc = i.file + (i.line > 0 ? `:${i.line}` : "");
      lines.push(`- **\`${loc}\`**：${i.comment}`);
      if (i.suggestion) lines.push(`  > 💡 建议：${i.suggestion}`);
      if (i.diff) lines.push("", "  ```diff", ...indentDiff(i.diff), "  ```");
    }
    lines.push("");
  }
  if (issues.length === 0) {
    lines.push("未发现明显问题。", "");
  }
  lines.push("</details>");
  return lines.join("\n").trim();
}

function indentDiff(diff: string): string[] {
  return diff.split("\n").map((line) => (line ? "  " + line : "  "));
}

/** 解析 diff patch，返回新增行（+ 行）的新文件行号集合，用于校验 LLM 给出的行号 */
export function parsePatchLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (m) {
      newLine = Number(m[2]);
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.add(newLine);
      newLine++;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      // 删除行不推进新行号
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" 标记
    } else {
      newLine++;
    }
  }
  return lines;
}

/** 校验 issue 行号：不在 diff 新增行集合中的 line 归 0（只进报告，不生成行内评论） */
export function validateIssueLines(
  issues: ReviewIssue[],
  files: Array<{ filename: string; patch?: string }>
): ReviewIssue[] {
  const validLines = new Map<string, Set<number>>();
  for (const f of files) {
    if (f.patch) validLines.set(f.filename, parsePatchLines(f.patch));
  }
  return issues.map((i) => {
    if (i.line > 0 && validLines.get(i.file)?.has(i.line)) return i;
    return { ...i, line: 0 };
  });
}
