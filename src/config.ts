export type AiProvider = "anthropic" | "openai" | "gemini";

const MODEL_DEFAULTS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
};

export interface AppConfig {
  provider: AiProvider;
  model: string;
  /** 统一 AI_API_KEY；未设置时在 providers 层回退到提供方专属 key */
  apiKey: string;
  /** 统一 AI_BASE_URL（代理网关）；未设置时回退到提供方专属 base url / 官方默认 */
  baseUrl: string;
  /** 发送给 AI 的 diff 最大字符数 */
  maxDiffLength: number;
}

export function loadConfig(): AppConfig {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (!(provider in MODEL_DEFAULTS)) {
    throw new Error(
      `不支持的 AI_PROVIDER: ${provider}（仅支持 anthropic | openai | gemini）`
    );
  }

  return {
    provider: provider as AiProvider,
    model: process.env.AI_MODEL ?? MODEL_DEFAULTS[provider as AiProvider],
    apiKey: process.env.AI_API_KEY ?? "",
    baseUrl: trimTrailingSlash(process.env.AI_BASE_URL ?? ""),
    maxDiffLength: Number(process.env.MAX_DIFF_LENGTH ?? 40000),
  };
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
