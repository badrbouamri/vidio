import { groq } from "@ai-sdk/groq";
import { google } from "@ai-sdk/google";

// Groq primary (generous free tier: 1000 req/day, 200K tokens/day on
// openai/gpt-oss-120b), Gemini fallback (20 req/day cap) — see
// docs/DECISIONS.md. Shared by translate-subtitles, shorten-text, and
// detect-moments so all three fail over the same way. Deliberately NOT
// typed as `: readonly LanguageModel[]` — that union includes plain
// gateway-routed strings, which don't carry `.provider` for cost
// attribution (see llm-json.ts's ProviderLanguageModel).
export const TEXT_MODELS = [groq("openai/gpt-oss-120b"), google("gemini-3.8-flash")] as const;
