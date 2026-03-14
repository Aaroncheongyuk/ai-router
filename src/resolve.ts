import { loadRouterConfig, type LoadConfigOptions } from './config.js';
import type {
  ResolveRequest,
  ResolvedFallbackTarget,
  ResolvedRoute,
  RouterConfig,
  RuntimeEnvEntry,
} from './types.js';

function normalizeModelSelector(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildModelSelectorAliases(modelKey: string, model: RouterConfig['models']['models'][string]): Set<string> {
  const aliases = new Set<string>();
  for (const value of [modelKey, model?.wireModel]) {
    if (!value) continue;
    aliases.add(value);
    const normalized = normalizeModelSelector(value);
    if (normalized) {
      aliases.add(normalized);
    }
  }
  return aliases;
}

function buildModelAliasMap(config: RouterConfig): Map<string, string> {
  const models = config.models?.models ?? {};
  const aliasMap = new Map<string, string>();

  for (const [modelKey, model] of Object.entries(models)) {
    for (const alias of buildModelSelectorAliases(modelKey, model)) {
      const existing = aliasMap.get(alias);
      if (existing && existing !== modelKey) {
        throw new Error(`Ambiguous model selector alias: ${alias} -> ${existing}, ${modelKey}`);
      }
      aliasMap.set(alias, modelKey);
    }
  }

  return aliasMap;
}

function resolveCanonicalModelKey(config: RouterConfig, requestedModelKey: string): string {
  const models = config.models?.models ?? {};
  if (models[requestedModelKey]) {
    return requestedModelKey;
  }

  const aliasMap = buildModelAliasMap(config);
  const normalizedRequested = normalizeModelSelector(requestedModelKey);
  const canonicalModelKey = aliasMap.get(requestedModelKey) ?? aliasMap.get(normalizedRequested);
  if (canonicalModelKey) {
    return canonicalModelKey;
  }

  const knownModels = Object.keys(models).sort().join(', ');
  throw new Error(`Model not found in configs/models.yaml: ${requestedModelKey}. Known models: ${knownModels}`);
}

function buildRuntimeEnv(config: RouterConfig, providerKey: string, modelKey: string): RuntimeEnvEntry[] {
  const provider = config.providers.providers[providerKey];
  const model = config.models.models[modelKey];
  const env: RuntimeEnvEntry[] = [];

  if (provider.protocol === 'anthropic-messages') {
    if (provider.baseUrl) {
      env.push({
        name: 'ANTHROPIC_BASE_URL',
        source: { type: 'literal', value: provider.baseUrl },
      });
    }

    env.push({
      name: 'ANTHROPIC_MODEL',
      source: { type: 'literal', value: model.wireModel },
    });

    if (provider.auth?.type === 'env') {
      env.push({
        name: 'ANTHROPIC_API_KEY',
        source: { type: 'env', env: provider.auth.env },
      });
    }
  }

  return env;
}

function buildCompatNotes(runtime: string, providerProtocol: string): { strategy: string; notes: string[] } {
  if (providerProtocol === 'anthropic-messages') {
    return {
      strategy: 'anthropic-compatible',
      notes: [
        `Runtime ${runtime} should receive Anthropic-compatible env injection via wrapper or adapter.`,
        'Keep provider-specific logic outside the orchestration framework.',
      ],
    };
  }

  return {
    strategy: 'generic',
    notes: ['No runtime-specific compatibility notes defined yet.'],
  };
}

function resolveTargetFromModel(config: RouterConfig, requestedModelKey: string): ResolvedFallbackTarget {
  const modelKey = resolveCanonicalModelKey(config, requestedModelKey);
  const model = config.models.models[modelKey];
  const provider = config.providers.providers[model.provider];
  if (!provider) {
    throw new Error(`Provider not found in configs/providers.yaml: ${model.provider}`);
  }

  return {
    provider: model.provider,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    model: modelKey,
    wireModel: model.wireModel,
    auth: provider.auth,
    headers: provider.headers ?? {},
    runtimeEnv: buildRuntimeEnv(config, model.provider, modelKey),
    source: {
      model: `configs/models.yaml#models.${modelKey}`,
      provider: `configs/providers.yaml#providers.${model.provider}`,
      fallbacks: `configs/fallbacks.yaml#fallbacks.${modelKey}`,
    },
  };
}

export function validateRouterConfig(config: RouterConfig): void {
  if (!config?.providers?.providers) {
    throw new Error('Invalid router config: missing providers.providers');
  }
  if (!config?.models?.models) {
    throw new Error('Invalid router config: missing models.models');
  }
  if (!config?.routing?.routes) {
    throw new Error('Invalid router config: missing routing.routes');
  }
  if (!config?.fallbacks?.fallbacks) {
    throw new Error('Invalid router config: missing fallbacks.fallbacks');
  }

  buildModelAliasMap(config);

  for (const [modelKey, model] of Object.entries(config.models.models)) {
    if (!config.providers.providers[model.provider]) {
      throw new Error(`Model ${modelKey} references unknown provider: ${model.provider}`);
    }
  }

  for (const [runtimeKey, routes] of Object.entries(config.routing.routes)) {
    for (const [roleKey, modelKey] of Object.entries(routes)) {
      try {
        resolveCanonicalModelKey(config, modelKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid route ${runtimeKey}.${roleKey}: ${message}`);
      }
    }
  }

  for (const [sourceModelKey, fallbackModels] of Object.entries(config.fallbacks.fallbacks)) {
    try {
      resolveCanonicalModelKey(config, sourceModelKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid fallback source ${sourceModelKey}: ${message}`);
    }

    if (!Array.isArray(fallbackModels)) {
      throw new Error(`Invalid fallback list for ${sourceModelKey}: expected array`);
    }

    for (const fallbackModelKey of fallbackModels) {
      try {
        resolveCanonicalModelKey(config, fallbackModelKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid fallback target ${sourceModelKey} -> ${fallbackModelKey}: ${message}`);
      }
    }
  }
}

function findMatchingRole(routes: Record<string, string>, role: string): string | undefined {
  // Exact match
  if (routes[role]) {
    return role;
  }
  // Prefix match for sub-roles like crew/router_core -> crew
  for (const routeKey of Object.keys(routes)) {
    if (role.startsWith(routeKey + '/') && routes[routeKey]) {
      return routeKey;
    }
  }
  // Default fallback
  return routes.default ? 'default' : undefined;
}

export function resolveRouteFromConfig(config: RouterConfig, request: ResolveRequest): ResolvedRoute {
  validateRouterConfig(config);

  const runtimeRoutes = config.routing.routes[request.runtime];
  if (!runtimeRoutes) {
    throw new Error(`Unknown runtime: ${request.runtime}`);
  }

  const routeKey = findMatchingRole(runtimeRoutes, request.role);
  const requestedModelKey = routeKey ? runtimeRoutes[routeKey] : undefined;
  if (!requestedModelKey) {
    throw new Error(`No route defined for runtime=${request.runtime} role=${request.role}`);
  }

  const primary = resolveTargetFromModel(config, requestedModelKey);
  const fallbackModelKeys = config.fallbacks.fallbacks[primary.model] ?? config.fallbacks.fallbacks[requestedModelKey] ?? [];
  const fallbacks = fallbackModelKeys.map((fallbackModelKey) => resolveCanonicalModelKey(config, fallbackModelKey));
  const resolvedFallbacks = fallbacks.map((fallbackModelKey) => resolveTargetFromModel(config, fallbackModelKey));
  const compat = buildCompatNotes(request.runtime, primary.protocol);

  return {
    runtime: request.runtime,
    role: request.role,
    provider: primary.provider,
    protocol: primary.protocol,
    baseUrl: primary.baseUrl,
    model: primary.model,
    wireModel: primary.wireModel,
    fallbacks,
    resolvedFallbacks,
    auth: primary.auth,
    headers: primary.headers,
    runtimeEnv: primary.runtimeEnv,
    compat,
    source: {
      route: `configs/routing.yaml#routes.${request.runtime}.${routeKey}`,
      model: primary.source.model,
      provider: primary.source.provider,
      fallbacks: primary.source.fallbacks,
    },
  };
}

export async function validateLoadedRouterConfig(options: LoadConfigOptions = {}): Promise<RouterConfig> {
  const config = await loadRouterConfig(options);
  validateRouterConfig(config);
  return config;
}

export async function resolveRoute(request: ResolveRequest, options: LoadConfigOptions = {}): Promise<ResolvedRoute> {
  const config = await loadRouterConfig(options);
  return resolveRouteFromConfig(config, request);
}
