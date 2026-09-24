export function resolveAgentModelConfig({ model, baseUrl, environment = process.env } = {}) {
  const useOpenRouter = Boolean(environment.OPENROUTER_API_KEY) || !environment.OPENAI_API_KEY
  return {
    model: model ?? (useOpenRouter ? 'qwen/qwen3.8-omni-flash' : 'gpt-4.1-mini'),
    baseUrl: baseUrl === undefined ? (useOpenRouter ? 'https://openrouter.ai/api/v1' : null) : baseUrl,
  }
}
