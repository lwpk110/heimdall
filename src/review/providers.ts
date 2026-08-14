import { AppConfig } from "../config";

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

  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
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

async function callGemini(
  config: AppConfig,
  req: ReviewRequest
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
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
