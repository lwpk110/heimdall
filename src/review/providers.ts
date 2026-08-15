import { AppConfig, AiProvider } from "../config";

export interface ReviewRequest {
  systemPrompt: string;
  diff: string;
}

export async function generateReview(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  switch (config.provider) {
    case "anthropic":
      return callAnthropic(config, req);
    case "openai":
      return callOpenAI(config, req);
    case "gemini":
      return callGemini(config, req);
  }
}

/** 统一 AI_API_KEY 优先，否则取提供方专属 key */
function resolveApiKey(config: AppConfig, provider: AiProvider): string {
  if (config.apiKey) return config.apiKey;
  const envKey: Record<AiProvider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  return process.env[envKey[provider]] ?? "";
}

function missingKeyError(provider: AiProvider): string {
  return `缺少 API 密钥：请设置 AI_API_KEY（统一）或 ${provider.toUpperCase()}_API_KEY`;
}

/** 统一 AI_BASE_URL 优先，否则取提供方专属 base url，再回退官方默认 */
function resolveBaseUrl(config: AppConfig, provider: AiProvider, fallback: string): string {
  if (config.baseUrl) return config.baseUrl;
  const envKey: Record<AiProvider, string> = {
    anthropic: "ANTHROPIC_BASE_URL",
    openai: "OPENAI_BASE_URL",
    gemini: "GEMINI_BASE_URL",
  };
  return (process.env[envKey[provider]] ?? fallback).replace(/\/+$/, "");
}

async function callAnthropic(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  const apiKey = resolveApiKey(config, "anthropic");
  if (!apiKey) throw new Error(missingKeyError("anthropic"));

  const res = await fetch(
    `${resolveBaseUrl(config, "anthropic", "https://api.anthropic.com")}/v1/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        system: req.systemPrompt,
        messages: [{ role: "user", content: req.diff }],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Anthropic API 调用失败 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  // content 可能含 thinking 块，需取 type 为 text 的块
  return data.content?.find((block) => block.type === "text")?.text ?? "";
}

async function callOpenAI(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  const apiKey = resolveApiKey(config, "openai");
  if (!apiKey) throw new Error(missingKeyError("openai"));

  const res = await fetch(
    `${resolveBaseUrl(config, "openai", "https://api.openai.com/v1")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.diff },
        ],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`OpenAI API 调用失败 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  const apiKey = resolveApiKey(config, "gemini");
  if (!apiKey) throw new Error(missingKeyError("gemini"));

  const res = await fetch(
    `${resolveBaseUrl(config, "gemini", "https://generativelanguage.googleapis.com")}/v1beta/models/${config.model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: req.diff }] }],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API 调用失败 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
