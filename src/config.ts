export type AiProvider = "anthropic" | "openai" | "gemini";

const MODEL_DEFAULTS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
};

export interface AppConfig {
  provider: AiProvider;
  model: string;
  /** OpenAI 兼容端点基地址（本地模型如 Ollama / vLLM 可指向自建地址） */
  openaiBaseUrl: string;
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
    openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    maxDiffLength: Number(process.env.MAX_DIFF_LENGTH ?? 40000),
  };
}
