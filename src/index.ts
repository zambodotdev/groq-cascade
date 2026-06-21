/**
 * groq-cascade
 * A resilient multi-model fallback chain for the Groq API.
 *
 * Tries models in order. If a model fails (rate limit, error, empty response),
 * it falls through to the next one. Users always get a response.
 *
 * Works in Node.js 18+ with native fetch. Zero extra dependencies beyond groq-sdk.
 *
 * @example
 * import { groqCascade } from "groq-cascade";
 * const text = await groqCascade({
 *   apiKey: process.env.GROQ_API_KEY,
 *   system: "You are a helpful assistant.",
 *   user: "Explain the cascade pattern in one sentence.",
 * });
 */

export interface CascadeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CascadeOptions {
  apiKey: string;

  /** Your system prompt */
  system?: string;

  /** The user message */
  user: string;

  /** Full messages array — overrides system + user if provided */
  messages?: CascadeMessage[];

  /** Max tokens per attempt. Default: 1024 */
  maxTokens?: number;

  /** Sampling temperature. Default: 0.4 */
  temperature?: number;

  /**
   * Models to try in order. Defaults to the production cascade:
   * llama-3.3-70b → llama-3.1-8b → llama-4-scout → gemma2 → qwen-qwq → mixtral
   */
  models?: string[];

  /**
   * Minimum response length in characters before a result is considered valid.
   * Short/empty responses are treated as failures and fall to the next model.
   * Default: 40
   */
  minLength?: number;

  /**
   * Timeout per model attempt in milliseconds. Default: 12000
   */
  timeoutMs?: number;

  /**
   * Hard fallback string returned if ALL models fail.
   * If not set, an error is thrown when the cascade is exhausted.
   */
  fallback?: string;

  /**
   * Called on each model failure (useful for logging/monitoring).
   */
  onModelFailure?: (model: string, error: unknown) => void;
}

export interface CascadeResult {
  text: string;
  model: string;
  attempts: number;
  usedFallback: boolean;
}

// ── Default production cascade ────────────────────────────────────────────────
// Ordered by capability → speed. Adjust for your use case.

export const DEFAULT_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "gemma2-9b-it",
  "qwen-qwq-32b",
  "mixtral-8x7b-32768",
] as const;

// ── Main export ────────────────────────────────────────────────────────────────

export async function groqCascade(options: CascadeOptions): Promise<CascadeResult> {
  const {
    apiKey,
    system,
    user,
    messages,
    maxTokens = 1024,
    temperature = 0.4,
    models = DEFAULT_MODELS as unknown as string[],
    minLength = 40,
    timeoutMs = 12_000,
    fallback,
    onModelFailure,
  } = options;

  if (!apiKey) throw new Error("groq-cascade: apiKey is required");
  if (!user && !messages) throw new Error("groq-cascade: user or messages is required");

  const resolvedMessages: CascadeMessage[] = messages ?? [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user" as const, content: user },
  ];

  let attempts = 0;

  for (const model of models) {
    attempts++;
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: resolvedMessages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(`Groq API error: ${err}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };

      const text = data.choices?.[0]?.message?.content ?? "";

      if (text.length >= minLength) {
        return { text, model, attempts, usedFallback: false };
      }

      throw new Error(`Response too short (${text.length} chars < ${minLength} minimum)`);
    } catch (err) {
      onModelFailure?.(model, err);
    }
  }

  // All models exhausted
  if (fallback !== undefined) {
    return { text: fallback, model: "fallback", attempts, usedFallback: true };
  }

  throw new Error(`groq-cascade: all ${models.length} models failed after ${attempts} attempts`);
}

// ── Convenience: JSON response ─────────────────────────────────────────────────

export async function groqCascadeJson<T = Record<string, unknown>>(
  options: CascadeOptions,
): Promise<{ data: T; model: string; attempts: number }> {
  const result = await groqCascade({
    ...options,
    maxTokens: options.maxTokens ?? 2048,
  });

  const stripped = result.text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    return { data: JSON.parse(stripped) as T, model: result.model, attempts: result.attempts };
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return { data: JSON.parse(match[0]) as T, model: result.model, attempts: result.attempts };
      } catch {}
    }
    throw new Error(`groq-cascade: could not parse JSON from model response.\n\nRaw: ${result.text.slice(0, 200)}`);
  }
}
