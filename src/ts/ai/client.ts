export type Provider = "anthropic" | "openai" | "openrouter";

export interface AiConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

// auto = a repair message the session wrote, not the gm
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  auto?: boolean;
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  // openrouter ids are vendor/model
  openrouter: "anthropic/claude-sonnet-5",
};

const MAX_TOKENS = 16000;

interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

// anthropic messages api; the header allows calls straight from the browser
function anthropicRequest(config: AiConfig, system: string, messages: ChatMessage[]): ChatRequest {
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: {
      model: config.model || DEFAULT_MODELS.anthropic,
      max_tokens: MAX_TOKENS,
      // cache_control caches the long system prompt between turns
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: messages.map(({ role, content }) => ({ role, content })),
    },
  };
}

// openai chat completions; the system prompt is the first message
function openaiRequest(config: AiConfig, system: string, messages: ChatMessage[]): ChatRequest {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: {
      model: config.model || DEFAULT_MODELS.openai,
      messages: [{ role: "system", content: system }, ...messages.map(({ role, content }) => ({ role, content }))],
    },
  };
}

// openrouter speaks the openai format; x-title names the app on its dashboard
function openrouterRequest(config: AiConfig, system: string, messages: ChatMessage[]): ChatRequest {
  const model = config.model || DEFAULT_MODELS.openrouter;
  // anthropic models only cache with an explicit cache_control block
  const systemContent = model.startsWith("anthropic/") ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system;
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}`, "x-title": "Planestone Importer" },
    body: {
      model,
      messages: [{ role: "system", content: systemContent }, ...messages.map(({ role, content }) => ({ role, content }))],
    },
  };
}

const REQUESTS: Record<Provider, (config: AiConfig, system: string, messages: ChatMessage[]) => ChatRequest> = {
  anthropic: anthropicRequest,
  openai: openaiRequest,
  openrouter: openrouterRequest,
};

function replyText(provider: Provider, data: any): string {
  if (provider === "anthropic") {
    return (data?.content ?? [])
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("");
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

// one chat turn → the assistant's reply text
export async function sendChat(
  config: AiConfig,
  system: string,
  messages: ChatMessage[],
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<string> {
  const request = REQUESTS[config.provider](config, system, messages);
  const response = await fetcher(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${config.provider} ${response.status}: ${data?.error?.message ?? response.statusText}`);
  const text = replyText(config.provider, data);
  if (!text.trim()) throw new Error(`${config.provider} sent an empty reply`);
  return text;
}
