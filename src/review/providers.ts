import { AppConfig } from "../config";

export interface ReviewRequest {
  systemPrompt: string;
  diff: string;
}

export async function generateReview(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  if (config.provider === "anthropic") {
    return callAnthropic(config, req);
  }
  return callOpenAI(config, req);
}

async function callAnthropic(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 ANTHROPIC_API_KEY");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  });

  if (!res.ok) {
    throw new Error(`Anthropic API 调用失败 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
  });

  if (!res.ok) {
    throw new Error(`OpenAI API 调用失败 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}
