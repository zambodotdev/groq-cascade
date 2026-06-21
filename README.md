# groq-cascade

A resilient multi-model fallback chain for the Groq API. When one model fails, it tries the next. Users always get a response.

Built from production infrastructure at [zambo.dev](https://zambo.dev), powering 17 AI products since 2026.

---

## The problem

AI apps that call a single model break in production:
- Rate limits hit at peak hours
- Models go offline during maintenance
- Context windows exceeded on edge cases
- Empty responses returned silently

Most engineers handle this with a try/catch that shows users an error. This is worse.

---

## The solution

A cascade that tries 6 models in order. If model 1 fails for any reason, it falls to model 2. Down the chain until something works. If everything fails, you can define a hardcoded fallback so users still get something.

```
llama-3.3-70b-versatile  ← try first (best quality)
  ↓ fails
llama-3.1-8b-instant     ← fast, high availability
  ↓ fails
llama-4-scout-17b        ← Meta's latest
  ↓ fails
gemma2-9b-it             ← Google, different infra
  ↓ fails
qwen-qwq-32b             ← Alibaba, different limits
  ↓ fails
mixtral-8x7b-32768       ← Mistral, long context
  ↓ fails
"your hardcoded fallback" ← always works
```

---

## Install

```bash
npm install groq-cascade
# or
pnpm add groq-cascade
```

---

## Usage

### Basic

```ts
import { groqCascade } from "groq-cascade";

const result = await groqCascade({
  apiKey: process.env.GROQ_API_KEY,
  system: "You are a helpful assistant.",
  user: "Summarize this document in 3 bullet points.",
  fallback: "I'm having trouble right now. Please try again in a moment.",
});

console.log(result.text);   // the response
console.log(result.model);  // which model answered
console.log(result.attempts); // how many models were tried
```

### JSON responses

```ts
import { groqCascadeJson } from "groq-cascade";

const { data, model } = await groqCascadeJson<{ score: number; reason: string }>({
  apiKey: process.env.GROQ_API_KEY,
  system: "Return only valid JSON.",
  user: "Score this idea from 0-100 and explain why: autonomous drone delivery",
});

console.log(data.score, data.reason);
```

### Custom model list

```ts
import { groqCascade } from "groq-cascade";

const result = await groqCascade({
  apiKey: process.env.GROQ_API_KEY,
  user: "Quick question: what's 2+2?",
  models: ["llama-3.1-8b-instant", "gemma2-9b-it"], // just use fast models
  maxTokens: 64,
  temperature: 0,
  fallback: "4",
});
```

### Log failures (monitoring)

```ts
const result = await groqCascade({
  apiKey: process.env.GROQ_API_KEY,
  user: "...",
  onModelFailure: (model, error) => {
    console.warn(`[cascade] ${model} failed:`, error);
    // send to Datadog, Sentry, etc.
  },
});
```

---

## API

### `groqCascade(options)` → `Promise<CascadeResult>`

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Groq API key |
| `user` | `string` | required | User message |
| `system` | `string` | — | System prompt |
| `messages` | `CascadeMessage[]` | — | Full messages array (overrides system + user) |
| `models` | `string[]` | 6-model default | Models to try in order |
| `maxTokens` | `number` | `1024` | Max tokens per attempt |
| `temperature` | `number` | `0.4` | Sampling temperature |
| `minLength` | `number` | `40` | Min response chars before treating as failure |
| `timeoutMs` | `number` | `12000` | Per-model timeout in ms |
| `fallback` | `string` | — | Returned if all models fail (instead of throwing) |
| `onModelFailure` | `fn(model, err)` | — | Called on each failure |

### `groqCascadeJson<T>(options)` → `Promise<{ data: T, model: string, attempts: number }>`

Same options. Automatically strips markdown code fences and parses JSON. Throws if no valid JSON found.

---

## License

MIT

Built by [Brennan Zambo](https://zambo.dev) · [@zambodotdev](https://x.com/zambodotdev)
