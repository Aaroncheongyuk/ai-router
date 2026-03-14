#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const DEFAULT_CONFIG_DIR = path.join(__dirname, '..', 'configs');

function loadJsonConfig(configDir, filename) {
  const filePath = path.join(configDir, filename);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Error loading ${filename}: ${err.message}`);
    process.exit(1);
  }
}

function unwrapMap(payload, key) {
  if (payload && typeof payload === 'object' && payload[key] && typeof payload[key] === 'object') {
    return payload[key];
  }
  return payload;
}

function unique(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function buildRuntimeEnv(providerConfig, modelName, modelConfig) {
  return [
    {
      name: 'ANTHROPIC_BASE_URL',
      source: { type: 'literal', value: providerConfig.baseUrl },
    },
    {
      name: 'ANTHROPIC_MODEL',
      source: { type: 'literal', value: modelConfig.wireModel || modelName },
    },
    {
      name: 'ANTHROPIC_API_KEY',
      source: { type: 'env', env: providerConfig.apiKeyEnv },
    },
  ];
}

function getRuntimeConfig(routes, runtime) {
  const candidate = routes?.[runtime];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return candidate;
}

function getRoleCandidates(role) {
  const candidates = [];
  let current = role;
  while (current) {
    candidates.push(current);
    const slashIndex = current.lastIndexOf('/');
    if (slashIndex < 0) break;
    current = current.slice(0, slashIndex);
  }
  return candidates;
}

function resolveRuntimeRoute(routes, runtime, role, trail = []) {
  if (trail.includes(runtime)) {
    throw new Error(`Routing inheritance cycle detected: ${[...trail, runtime].join(' -> ')}`);
  }

  const runtimeConfig = getRuntimeConfig(routes, runtime);
  if (!runtimeConfig) {
    return null;
  }

  for (const candidateRole of getRoleCandidates(role)) {
    const directRoute = runtimeConfig[candidateRole];
    if (directRoute && typeof directRoute === 'object' && !Array.isArray(directRoute)) {
      return {
        route: directRoute,
        matchedRole: candidateRole,
        resolvedRuntime: directRoute.runtime || runtimeConfig.runtime || runtime,
        sourceRoute: `configs/routing.json#routes.${runtime}.${candidateRole}`,
        inherited: false,
      };
    }
  }

  if (typeof runtimeConfig.inherits === 'string' && runtimeConfig.inherits) {
    const inheritedRoute = resolveRuntimeRoute(routes, runtimeConfig.inherits, role, [...trail, runtime]);
    if (inheritedRoute) {
      return {
        ...inheritedRoute,
        resolvedRuntime: runtimeConfig.runtime || runtime,
        inherited: true,
        inheritedFrom: `configs/routing.json#routes.${runtime}.inherits`,
      };
    }
  }

  return null;
}

function resolveRoute(runtime, role, config) {
  const routes = unwrapMap(config.routing, 'routes');
  const models = unwrapMap(config.models, 'models');
  const providers = unwrapMap(config.providers, 'providers');
  const fallbackMap = unwrapMap(config.fallbacks, 'fallbacks');

  let route = null;
  let routeSource = null;
  let resolvedRuntime = runtime;
  let inheritedFrom = null;

  try {
    const runtimeRoute = resolveRuntimeRoute(routes, runtime, role);
    if (runtimeRoute) {
      route = runtimeRoute.route;
      routeSource = runtimeRoute.sourceRoute;
      resolvedRuntime = runtimeRoute.resolvedRuntime;
      inheritedFrom = runtimeRoute.inheritedFrom || null;
    } else if (routes?.default) {
      route = routes.default;
      resolvedRuntime = routes.default.runtime || runtime;
      routeSource = 'configs/routing.json#routes.default';
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (!route && routes?.default) {
    route = routes.default;
    resolvedRuntime = routes.default.runtime || runtime;
    routeSource = 'configs/routing.json#routes.default';
  }

  if (!route) {
    console.error(`No route found for runtime=${runtime}, role=${role}`);
    process.exit(1);
  }

  const primaryRouteModel = Array.isArray(route.modelChain) && route.modelChain.length > 0
    ? route.modelChain[0]
    : (route.model || route.primaryModel);

  if (!primaryRouteModel) {
    console.error(`Route missing model/modelChain for runtime=${runtime}, role=${role}`);
    process.exit(1);
  }

  const candidateNames = unique(
    Array.isArray(route.modelChain) && route.modelChain.length > 0
      ? route.modelChain
      : [primaryRouteModel, ...(fallbackMap?.[primaryRouteModel] || [])]
  ).filter((name) => Boolean(models?.[name]));

  if (candidateNames.length === 0) {
    console.error(`No valid models found for runtime=${runtime}, role=${role}`);
    process.exit(1);
  }

  const primaryModel = candidateNames[0];
  const modelConfig = models[primaryModel];
  const providerName = modelConfig.provider;
  const providerConfig = providers[providerName];

  if (!providerConfig) {
    console.error(`Provider not found: ${providerName}`);
    process.exit(1);
  }

  const resolvedFallbacks = candidateNames.slice(1).map((fallbackModelName) => {
    const fallbackModelConfig = models[fallbackModelName];
    const fallbackProviderName = fallbackModelConfig.provider;
    const fallbackProviderConfig = providers[fallbackProviderName];

    return {
      provider: fallbackProviderName,
      protocol: fallbackProviderConfig.protocol,
      baseUrl: fallbackProviderConfig.baseUrl,
      model: fallbackModelName,
      wireModel: fallbackModelConfig.wireModel || fallbackModelName,
      auth: {
        type: 'env',
        env: fallbackProviderConfig.apiKeyEnv,
      },
      headers: fallbackProviderConfig.headers || {},
      runtimeEnv: buildRuntimeEnv(fallbackProviderConfig, fallbackModelName, fallbackModelConfig),
      source: {
        model: `configs/models.json#models.${fallbackModelName}`,
        provider: `configs/providers.json#providers.${fallbackProviderName}`,
        fallbacks: `configs/fallbacks.json#fallbacks.${primaryModel}`,
      },
    };
  });

  return {
    runtime: resolvedRuntime,
    role,
    provider: providerName,
    protocol: providerConfig.protocol,
    baseUrl: providerConfig.baseUrl,
    model: primaryModel,
    wireModel: modelConfig.wireModel || primaryModel,
    fallbacks: candidateNames.slice(1),
    resolvedFallbacks,
    auth: {
      type: 'env',
      env: providerConfig.apiKeyEnv,
    },
    headers: providerConfig.headers || {},
    runtimeEnv: buildRuntimeEnv(providerConfig, primaryModel, modelConfig),
    compat: {
      strategy: 'anthropic-compatible',
      notes: [
        'Wrapper should inject env instead of hard-coding provider logic in Gastown.',
      ],
    },
    source: {
      route: routeSource,
      ...(inheritedFrom ? { inheritedFrom } : {}),
      model: `configs/models.json#models.${primaryModel}`,
      provider: `configs/providers.json#providers.${providerName}`,
      fallbacks: `configs/fallbacks.json#fallbacks.${primaryModel}`,
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: ai-router <command> [options]');
    console.error('Commands:');
    console.error('  resolve --runtime <runtime> --role <role>');
    process.exit(1);
  }

  const command = argv[0];
  if (command !== 'resolve') {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }

  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      runtime: { type: 'string' },
      role: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    console.error('Usage: resolve --runtime <runtime> --role <role>');
    process.exit(0);
  }

  const runtime = parsed.values.runtime;
  const role = parsed.values.role;
  if (!runtime || !role) {
    console.error('Error: --runtime and --role are required');
    process.exit(1);
  }

  const configDir = process.env.AI_ROUTER_CONFIG_DIR || DEFAULT_CONFIG_DIR;
  const config = {
    providers: loadJsonConfig(configDir, 'providers.json'),
    models: loadJsonConfig(configDir, 'models.json'),
    routing: loadJsonConfig(configDir, 'routing.json'),
    fallbacks: loadJsonConfig(configDir, 'fallbacks.json'),
  };

  const result = resolveRoute(runtime, role, config);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
