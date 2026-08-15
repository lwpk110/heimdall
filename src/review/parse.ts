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
  /** 原生一键替换代码块（可选，无 diff 前缀，供 GitHub 1-Click Suggestion 渲染） */
  suggestionCode?: string;
  /** 具体代码修改建议（可选，diff 格式，- 删 / + 增） */
  diff?: string;
}

export interface ReviewResult {
  summary: string;
  focusAreas?: string[];
  verificationSteps?: string[];
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
  const obj = data as {
    summary?: unknown;
    focus_areas?: unknown;
    focusAreas?: unknown;
    verification_steps?: unknown;
    verificationSteps?: unknown;
    issues?: unknown;
  };
  const issues = Array.isArray(obj.issues)
    ? dedupeIssues(
        obj.issues
          .map(normalizeIssue)
          .filter((i): i is ReviewIssue => i !== null)
      )
    : [];

  const rawFocus = Array.isArray(obj.focus_areas) ? obj.focus_areas : Array.isArray(obj.focusAreas) ? obj.focusAreas : [];
  const focusAreas = rawFocus.map(String).filter(Boolean);

  const rawSteps = Array.isArray(obj.verification_steps) ? obj.verification_steps : Array.isArray(obj.verificationSteps) ? obj.verificationSteps : [];
  const verificationSteps = rawSteps.map(String).filter(Boolean);

  const result: ReviewResult = {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    issues,
  };
  if (focusAreas.length > 0) result.focusAreas = focusAreas;
  if (verificationSteps.length > 0) result.verificationSteps = verificationSteps;
  return result;
}

/** 去重：同一 文件+行号+严重度 的重复问题只保留一条（LLM 偶发重复输出） */
function dedupeIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const seen = new Set<string>();
  const out: ReviewIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.file}:${issue.line}:${issue.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
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
  const suggestionCode = typeof item.suggestion_code === "string"
    ? item.suggestion_code.trim()
    : typeof item.suggestionCode === "string"
    ? item.suggestionCode.trim()
    : "";
  const diff = typeof item.diff === "string" ? item.diff.trim() : "";
  if (!file || !comment) return null;
  const issue: ReviewIssue = {
    severity,
    file,
    line: line > 0 ? line : 0,
    comment,
  };
  if (suggestion) issue.suggestion = suggestion;
  if (suggestionCode) issue.suggestionCode = suggestionCode;
  if (diff) issue.diff = diff;
  return issue;
}

export type ReviewLanguage = "en" | "zh" | "bilingual";

interface ReviewLabels {
  overview: string;
  focusAreas: string;
  verification: string;
  reviewComments: string;
  tableHeader: string;
  fixClick: string;
  fixDiff: string;
  fixNote: string;
  suggestion: string;
  noIssues: string;
  severity: Record<Severity, string>;
  // report header
  reportTitle: string;
  reportSubtitle: string;
  status: string;
  risk: string;
  scale: string;
  statusBlock: string;
  statusAttention: string;
  statusPass: string;
  filesDetail: string;
  fileCol: string;
  changeCol: string;
  reviewInfo: string;
  filesReviewed: string;
  changeSize: string;
  guardian: string;
  noChange: string;
  reviewFailed: string;
  fixSuggestion: string;
}

export const LABELS: Record<ReviewLanguage, ReviewLabels> = {
  en: {
    overview: "### 📖 Overview",
    focusAreas: "#### 🎯 Focus Areas",
    verification: "### 🧪 Suggested Regression Tests",
    reviewComments: "🔍 Review Comments & Issues",
    tableHeader: "| Severity | Location | Issue | Fix Support |",
    fixClick: "⚡ 1-Click Suggestion",
    fixDiff: "💡 Diff Provided",
    fixNote: "📝 Note",
    suggestion: "💡 Suggestion",
    noIssues: "No significant issues found.",
    severity: { critical: "### 🔴 Critical", important: "### 🟡 Important", normal: "### 🟢 Normal" },
    reportTitle: "🛡️ Heimdall · Code Review Report",
    reportSubtitle: "*\"Guard every line, watch the gate\"*",
    status: "Status",
    risk: "Risk Distribution",
    scale: "Change Scale",
    statusBlock: "🔴 **BLOCK MERGE**",
    statusAttention: "🟡 **Needs Attention**",
    statusPass: "🟢 **Pass**",
    filesDetail: "File Changes",
    fileCol: "File",
    changeCol: "Change",
    reviewInfo: "ℹ️ Review Info",
    filesReviewed: "Files reviewed",
    changeSize: "Change size",
    guardian: "Guardian persona",
    noChange: "No reviewable code changes in this PR.",
    reviewFailed: "Review failed",
    fixSuggestion: "Fix Suggestion",
  },
  zh: {
    overview: "### 📖 变更概述",
    focusAreas: "#### 🎯 重点复核领域",
    verification: "### 🧪 建议回归测试清单",
    reviewComments: "🔍 审查评论与问题清单",
    tableHeader: "| 严重度 | 位置 | 问题 | 修复支持 |",
    fixClick: "⚡ 1-Click Suggestion",
    fixDiff: "💡 附 Diff 代码",
    fixNote: "📝 说明",
    suggestion: "💡 建议",
    noIssues: "未发现明显问题。",
    severity: { critical: "### 🔴 严重问题", important: "### 🟡 建议改进", normal: "### 🟢 良好实践" },
    reportTitle: "🛡️ 海姆达尔 (Heimdall) · 代码审查报告",
    reportSubtitle: "*\"看穿每一行代码，守护合并之门\"*",
    status: "审查状态",
    risk: "风险分布",
    scale: "变更规模",
    statusBlock: "🔴 **阻断合并**",
    statusAttention: "🟡 **需关注**",
    statusPass: "🟢 **可以通过**",
    filesDetail: "文件变更明细",
    fileCol: "文件",
    changeCol: "变更规模",
    reviewInfo: "审查环境与元数据",
    filesReviewed: "审查文件",
    changeSize: "变更规模",
    guardian: "守护者人设",
    noChange: "本次 PR 没有可审查的代码变更。",
    reviewFailed: "审查失败",
    fixSuggestion: "修复建议",
  },
  bilingual: {
    overview: "### 📖 Overview / 变更概述",
    focusAreas: "#### 🎯 Focus Areas / 重点复核领域",
    verification: "### 🧪 Suggested Regression Tests / 建议回归测试清单",
    reviewComments: "🔍 Review Comments & Issues / 审查评论与问题清单",
    tableHeader: "| Severity / 严重度 | Location / 位置 | Issue / 问题 | Fix / 修复支持 |",
    fixClick: "⚡ 1-Click Suggestion",
    fixDiff: "💡 Diff Provided / 附 Diff",
    fixNote: "📝 Note / 说明",
    suggestion: "💡 Suggestion / 建议",
    noIssues: "No significant issues found. / 未发现明显问题。",
    severity: { critical: "### 🔴 Critical / 严重问题", important: "### 🟡 Important / 建议改进", normal: "### 🟢 Normal / 良好实践" },
    reportTitle: "🛡️ Heimdall · Code Review Report / 海姆达尔代码审查报告",
    reportSubtitle: "*\"Guard every line, watch the gate\" / \"看穿每一行代码，守护合并之门\"*",
    status: "Status / 审查状态",
    risk: "Risk / 风险分布",
    scale: "Change / 变更规模",
    statusBlock: "🔴 **BLOCK MERGE / 阻断合并**",
    statusAttention: "🟡 **Needs Attention / 需关注**",
    statusPass: "🟢 **Pass / 可以通过**",
    filesDetail: "File Changes / 文件变更明细",
    fileCol: "File / 文件",
    changeCol: "Change / 变更规模",
    reviewInfo: "Review Info / 审查环境与元数据",
    filesReviewed: "Files reviewed / 审查文件",
    changeSize: "Change size / 变更规模",
    guardian: "Guardian / 守护者人设",
    noChange: "No reviewable code changes. / 本次 PR 没有可审查的代码变更。",
    reviewFailed: "Review failed / 审查失败",
    fixSuggestion: "Fix Suggestion / 修复建议",
  },
};

/** 把结构化结果渲染为 markdown 报告（不含头部统计行，含折叠块）；language 默认 en */
export function renderMarkdown(result: ReviewResult, language: ReviewLanguage = "en"): string {
  const L = LABELS[language];
  const { summary, focusAreas, verificationSteps, issues } = result;
  const lines: string[] = [];

  if (summary) {
    lines.push(L.overview, summary, "");
  }

  if (focusAreas && focusAreas.length > 0) {
    lines.push(L.focusAreas);
    for (const area of focusAreas) {
      lines.push(`- ${area}`);
    }
    lines.push("");
  }

  if (verificationSteps && verificationSteps.length > 0) {
    lines.push(L.verification);
    for (const step of verificationSteps) {
      lines.push(`- [ ] ${step}`);
    }
    lines.push("");
  }

  lines.push("<details>", `<summary>${L.reviewComments}</summary>`, "");

  // line>0 的问题用表格汇总（详情在行内评论）；line=0 的问题列表展示完整详情
  const inlineIssues = issues.filter((i) => i.line > 0);
  const orphanIssues = issues.filter((i) => i.line === 0);
  if (inlineIssues.length > 0) {
    lines.push(L.tableHeader, "| :---: | --- | --- | :---: |");
    for (const i of inlineIssues) {
      const loc = `\`${i.file}:${i.line}\``;
      const fixStatus = i.suggestionCode ? L.fixClick : i.diff ? L.fixDiff : L.fixNote;
      lines.push(`| ${SEVERITY_ICONS[i.severity]} | ${loc} | ${i.comment} | ${fixStatus} |`);
    }
    lines.push("");
  }
  for (const sev of SEVERITIES) {
    const group = orphanIssues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(L.severity[sev], "");
    for (const i of group) {
      lines.push(`- **\`${i.file}\`**：${i.comment}`);
      if (i.suggestion) lines.push(`  > ${L.suggestion}：${i.suggestion}`);
      if (i.suggestionCode) {
        lines.push("", "  ```suggestion", ...indentDiff(i.suggestionCode), "  ```");
      } else if (i.diff) {
        lines.push("", "  ```diff", ...indentDiff(i.diff), "  ```");
      }
    }
    lines.push("");
  }
  if (issues.length === 0) {
    lines.push(L.noIssues, "");
  }
  lines.push("</details>");
  return lines.join("\n").trim();
}

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: "🔴",
  important: "🟡",
  normal: "🟢",
};

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

/**
 * 将待审查文件组合为 diff 文本，按文件与行边界做安全截断，
 * 避免字符级 slice 导致 mid-line 或未闭合代码块语法坏死。
 */
export function formatSafeDiff(
  files: Array<{ filename: string; patch?: string }>,
  maxDiffLength: number
): string {
  const blocks: string[] = [];
  let currentLen = 0;
  let truncated = false;

  for (const f of files) {
    if (!f.patch) continue;
    const header = `### ${f.filename}\n\`\`\`diff\n`;
    const footer = `\n\`\`\``;

    if (currentLen + header.length + footer.length > maxDiffLength) {
      truncated = true;
      break;
    }

    let fileContent = header;
    currentLen += header.length;
    const patchLines = f.patch.split("\n");

    let linesAdded = 0;
    for (const line of patchLines) {
      const lineLen = line.length + 1;
      if (currentLen + lineLen + footer.length > maxDiffLength) {
        truncated = true;
        break;
      }
      fileContent += (linesAdded > 0 ? "\n" : "") + line;
      currentLen += lineLen;
      linesAdded++;
    }

    fileContent += footer;
    currentLen += footer.length;
    blocks.push(fileContent);

    if (truncated) break;
  }

  let result = blocks.join("\n\n");
  if (truncated && result.trim()) {
    result += "\n\n[⚠️ Diff 规模过大，已在文件/行边界处自动截断以适应 LLM 上下文]";
  }
  return result;
}
