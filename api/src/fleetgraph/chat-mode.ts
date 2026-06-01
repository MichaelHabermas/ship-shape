// FleetGraph chat mode: PM conversation requires a configured OpenAI key and model name.
function envFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function shouldUseChatModel(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim()) && Boolean(env.FLEETGRAPH_MODEL?.trim());
}

export function shouldUseProactiveCreateModel(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env.FLEETGRAPH_REAL_MODEL_ENABLED)
    && Boolean(env.FLEETGRAPH_MODEL?.trim())
    && Boolean(env.OPENAI_API_KEY?.trim());
}
