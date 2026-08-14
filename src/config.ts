export type AiProvider = "anthropic" | "openai";

export interface AppConfig {
  provider: AiProvider;
  model: string;
  /** 发送给 AI 的 diff 最大字符数 */
  maxDiffLength: number;
}

export function loadConfig(): AppConfig {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(`不支持的 AI_PROVIDER: ${provider}（仅支持 anthropic | openai）`);
  }

  return {
    provider,
    model:
      process.env.AI_MODEL ??
      (provider === "anthropic" ? "claude-sonnet-4-5-20250929" : "gpt-4o"),
    maxDiffLength: Number(process.env.MAX_DIFF_LENGTH ?? 40000),
  };
}
