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
}

/** 解析 heimdall.yml（支持标量、内联数组、块列表、块文本 |，忽略其他键以兼容未来扩展） */
export function parseHeimdallConfig(text: string): RepoConfig {
  const cfg: RepoConfig = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1] as keyof RepoConfig;
    let rest = match[2].trim();

    if (rest === "|") {
      const block: string[] = [];
      i++;
      while (i < lines.length && lines[i].startsWith(" ") && lines[i].trim() !== "") {
        block.push(lines[i].replace(/^\s+/, ""));
        i++;
      }
      if (block.length) setValue(cfg, key, block.join("\n"));
      continue;
    }

    if (rest.startsWith("[")) {
      const inner = rest.slice(1, rest.lastIndexOf("]"));
      const arr = inner
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      setValue(cfg, key, arr);
      i++;
      continue;
    }

    if (rest === "") {
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s*-/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""));
        i++;
      }
      if (items.length) setValue(cfg, key, items);
      else {
        setValue(cfg, key, undefined);
        i++;
      }
      continue;
    }

    setValue(cfg, key, parseScalar(rest));
    i++;
  }
  return cfg;
}

function setValue(cfg: RepoConfig, key: keyof RepoConfig, value: unknown): void {
  if (value === undefined) return;
  switch (key) {
    case "version":
      if (typeof value === "number") cfg.version = value;
      break;
    case "include":
    case "exclude":
      if (Array.isArray(value)) cfg[key] = value.map(String);
      break;
    case "min_severity":
      if (value === "critical" || value === "important" || value === "normal") {
        cfg.min_severity = value;
      }
      break;
    case "instructions":
      if (typeof value === "string") cfg.instructions = value;
      break;
  }
}

function parseScalar(raw: string): string | number | boolean {
  if (/^["'].*["']$/.test(raw)) return raw.slice(1, -1);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
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
