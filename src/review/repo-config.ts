import { ReviewIssue, ReviewResult, Severity } from "./parse";

/**
 * .github/heimdall.yml 配置（PRD §5.2）
 * 使用 schema 感知的轻量解析器，避免在零依赖的 Actions 脚本中引入 YAML 库。
 */
export interface RepoConfig {
  version?: number;
  /** 只审查匹配的文件（glob）；为空表示不限制 */
  include?: string[];
  /** 排除匹配的文件（glob） */
  exclude?: string[];
  /** 低于该严重度的 issue 不进报告：critical | important | normal */
  min_severity?: Severity;
  /** 团队自定义审查指令，追加到系统 prompt */
  instructions?: string;
  /** 可按需触发 @heimdall review 的账号白名单；为空表示不限制 */
  manual_reviewers?: string[];
  /** 存在未解决 critical 问题时设置 heimdall/critical 状态为失败，阻断合并 */
  block_on_critical?: boolean;
  /** 是否自动审查（PR 打开/更新时）；设为 false 则仅响应 @heimdall review（默认 true） */
  auto_review?: boolean;
  /** 仓库级可观测性覆盖（默认由环境变量决定） */
  observability?: {
    logs?: {
      enabled?: boolean;
      invocation_logs?: boolean;
    };
  };
}

/**
 * 解析 heimdall.yml（支持标量、内联数组、块列表、块文本 |、嵌套 map，
 * 忽略未知键以兼容未来扩展）。
 */
export function parseHeimdallConfig(text: string): RepoConfig {
  const lines = text.split(/\r?\n/);
  const parsed = parseObject(lines, 0, -1);
  const cfg: RepoConfig = {};
  assignKnown(cfg, parsed.value ?? {});
  return cfg;
}

/** 返回一行的缩进空格数（空行返回 -1） */
function lineIndent(line: string): number {
  return line.search(/\S/);
}

/**
 * 从 start 开始解析一个 map 节点，遇到缩进 <= parentIndent 的行（或结尾）停止。
 * 返回解析出的对象与下一个待处理下标。
 */
function parseObject(
  lines: string[],
  start: number,
  parentIndent: number,
  depth = 0
): { value: Record<string, unknown>; next: number } {
  if (depth > 50) return { value: {}, next: start }; // 深度保护：避免病态嵌套导致栈溢出
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const indent = lineIndent(lines[i]);
    if (indent <= parentIndent) break;

    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    const rest = match[2].trim();
    i++;

    if (rest === "|") {
      const block: string[] = [];
      // 块文本：保留内部空行，直到遇到缩进 <= 键的行（或结尾）才结束
      while (i < lines.length) {
        const li = lineIndent(lines[i]);
        if (li === -1) {
          block.push("");
          i++;
          continue;
        }
        if (li > indent) {
          block.push(lines[i].replace(/^\s+/, ""));
          i++;
          continue;
        }
        break;
      }
      while (block.length && block[block.length - 1] === "") block.pop();
      if (block.length) obj[key] = block.join("\n");
      continue;
    }

    if (rest.startsWith("[")) {
      const inner = rest.slice(1, rest.lastIndexOf("]"));
      obj[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }

    if (rest === "") {
      // 先跳过空行与注释，再判断子值是列表还是嵌套 map
      let j = i;
      while (j < lines.length) {
        const t = lines[j].trim();
        if (t === "" || t.startsWith("#")) {
          j++;
          continue;
        }
        break;
      }
      if (j < lines.length) {
        const nIndent = lineIndent(lines[j]);
        if (nIndent > indent && /^\s*-/.test(lines[j])) {
          const items: string[] = [];
          let k = j;
          while (k < lines.length && lineIndent(lines[k]) > indent && /^\s*-/.test(lines[k])) {
            items.push(lines[k].replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""));
            k++;
          }
          obj[key] = items;
          i = k;
          continue;
        }
        if (nIndent > indent && /^[A-Za-z_][\w-]*:/.test(lines[j].trim())) {
          const sub = parseObject(lines, j, indent, depth + 1);
          obj[key] = sub.value;
          i = sub.next;
          continue;
        }
      }
      obj[key] = undefined;
      continue;
    }

    obj[key] = parseScalar(rest);
  }
  return { value: obj, next: i };
}

/** 把解析出的原始对象按 schema 写进 RepoConfig（未知键忽略） */
function assignKnown(cfg: RepoConfig, value: Record<string, unknown>): void {
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    switch (key) {
      case "version":
        if (typeof v === "number") cfg.version = v;
        break;
      case "include":
      case "exclude":
        if (Array.isArray(v)) cfg[key] = v.map(String);
        break;
      case "manual_reviewers":
        if (Array.isArray(v)) {
          cfg.manual_reviewers = v.map((x) => String(x).replace(/^@/, "").trim()).filter(Boolean);
        }
        break;
      case "min_severity":
        if (v === "critical" || v === "important" || v === "normal") {
          cfg.min_severity = v;
        }
        break;
      case "instructions":
        if (typeof v === "string") cfg.instructions = v;
        break;
      case "block_on_critical":
        if (typeof v === "boolean") cfg.block_on_critical = v;
        break;
      case "auto_review":
        if (typeof v === "boolean") cfg.auto_review = v;
        break;
      case "observability":
        assignObservability(cfg, v);
        break;
    }
  }
}

function assignObservability(cfg: RepoConfig, value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const rawLogs = (value as Record<string, unknown>).logs;
  if (typeof rawLogs !== "object" || rawLogs === null) return;
  const logs = rawLogs as Record<string, unknown>;
  const out: NonNullable<RepoConfig["observability"]>["logs"] = {};
  if (typeof logs.enabled === "boolean") out.enabled = logs.enabled;
  if (typeof logs.invocation_logs === "boolean") out.invocation_logs = logs.invocation_logs;
  if (Object.keys(out).length > 0) cfg.observability = { logs: out };
}

function parseScalar(raw: string): string | number | boolean {
  // 若包含带引号的文本，保留内容
  if (/^["'].*["']$/.test(raw)) return raw.slice(1, -1);
  // 剥离未加引号标量的行尾注释 (如 `true # comment`)
  const clean = raw.replace(/\s*#.*$/, "").trim();
  if (/^["'].*["']$/.test(clean)) return clean.slice(1, -1);
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(clean)) return Number(clean);
  return clean;
}

/** glob 匹配：支持 *（跨目录用 **）、**、?；无目录分隔符的模式同时匹配文件名 */
export function matchesAnyGlob(filename: string, patterns: string[]): boolean {
  return patterns.some((p) => globMatch(filename, p) || (!p.includes("/") && globMatch(filename.split("/").pop() ?? "", p)));
}

function globMatch(name: string, pattern: string): boolean {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.\\+^$(){}[\]|]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re).test(name);
}

/** 按 include/exclude 过滤待审查文件 */
export function filterFiles<T extends { filename: string }>(files: T[], cfg: RepoConfig): T[] {
  if (!cfg.include?.length && !cfg.exclude?.length) return files;
  return files.filter((f) => {
    if (cfg.include?.length && !matchesAnyGlob(f.filename, cfg.include)) return false;
    if (cfg.exclude?.length && matchesAnyGlob(f.filename, cfg.exclude)) return false;
    return true;
  });
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, important: 2, normal: 1 };

/** 按 min_severity 过滤 issue（低于阈值的不进报告与行内评论） */
export function filterByMinSeverity(result: ReviewResult, minSeverity?: Severity): ReviewResult {
  if (!minSeverity) return result;
  const min = SEVERITY_RANK[minSeverity];
  const issues = result.issues.filter((i: ReviewIssue) => SEVERITY_RANK[i.severity] >= min);
  return { summary: result.summary, issues };
}

/** 从仓库读取 .github/heimdall.yml（GitHub API contents，框架无关） */
export interface RepoOctokit {
  repos: {
    getContent(args: any): Promise<any>;
  };
}

export async function loadRepoConfigFromOctokit(
  octokit: RepoOctokit,
  owner: string,
  repo: string
): Promise<RepoConfig> {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: ".github/heimdall.yml" });
    if (!res.data.content) return {};
    return parseHeimdallConfig(Buffer.from(res.data.content, "base64").toString("utf8"));
  } catch {
    return {}; // 无配置文件（404）按默认行为
  }
}
