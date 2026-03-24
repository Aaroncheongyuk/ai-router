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

function loadAllConfigs(configDir) {
  return {
    providers: loadJsonConfig(configDir, 'providers.json'),
    models: loadJsonConfig(configDir, 'models.json'),
    routing: loadJsonConfig(configDir, 'routing.json'),
    fallbacks: loadJsonConfig(configDir, 'fallbacks.json'),
  };
}

function validateRoute(runtime, role, config) {
  const checks = [];
  const pass = (name, detail) => checks.push({ status: 'pass', name, detail });
  const fail = (name, detail) => checks.push({ status: 'fail', name, detail });
  const warn = (name, detail) => checks.push({ status: 'warn', name, detail });

  const routes = unwrapMap(config.routing, 'routes');
  const models = unwrapMap(config.models, 'models');
  const providers = unwrapMap(config.providers, 'providers');

  // Check 1: Route exists
  let resolved;
  try {
    resolved = resolveRoute(runtime, role, config);
    pass('route_exists', `${runtime}/${role} → model=${resolved.model}, provider=${resolved.provider}`);
  } catch {
    fail('route_exists', `No route found for runtime=${runtime}, role=${role}`);
    return { runtime, role, checks, score: 0 };
  }

  // Check 2: Fallback chain depth
  const chainLen = 1 + resolved.fallbacks.length;
  if (chainLen >= 3) {
    pass('fallback_depth', `Chain has ${chainLen} candidates`);
  } else if (chainLen === 2) {
    warn('fallback_depth', `Chain has only ${chainLen} candidates (recommend >= 3)`);
  } else {
    fail('fallback_depth', `Chain has only ${chainLen} candidate (no fallback!)`);
  }

  // Check 3: All models in chain exist in models.json
  const allModels = [resolved.model, ...resolved.fallbacks];
  const missingModels = allModels.filter((m) => !models[m]);
  if (missingModels.length === 0) {
    pass('models_exist', `All ${allModels.length} models found in models.json`);
  } else {
    fail('models_exist', `Missing from models.json: ${missingModels.join(', ')}`);
  }

  // Check 4: All providers in chain exist in providers.json
  const providerNames = new Set();
  providerNames.add(resolved.provider);
  for (const fb of resolved.resolvedFallbacks) {
    providerNames.add(fb.provider);
  }
  const missingProviders = [...providerNames].filter((p) => !providers[p]);
  if (missingProviders.length === 0) {
    pass('providers_exist', `All providers found: ${[...providerNames].join(', ')}`);
  } else {
    fail('providers_exist', `Missing from providers.json: ${missingProviders.join(', ')}`);
  }

  // Check 5: Auth env vars referenced
  const envVars = new Set();
  envVars.add(resolved.auth.env);
  for (const fb of resolved.resolvedFallbacks) {
    envVars.add(fb.auth.env);
  }
  for (const envVar of envVars) {
    if (process.env[envVar]) {
      pass('auth_env', `${envVar} is set`);
    } else {
      warn('auth_env', `${envVar} is not set in current environment`);
    }
  }

  // Check 6: No duplicate models in chain
  const seen = new Set();
  const duplicates = [];
  for (const m of allModels) {
    if (seen.has(m)) duplicates.push(m);
    seen.add(m);
  }
  if (duplicates.length === 0) {
    pass('no_duplicates', 'No duplicate models in chain');
  } else {
    warn('no_duplicates', `Duplicate models in chain: ${duplicates.join(', ')}`);
  }

  // Check 7: Provider diversity (warn if all same provider)
  if (providerNames.size >= 2) {
    pass('provider_diversity', `${providerNames.size} distinct providers for resilience`);
  } else {
    warn('provider_diversity', `All candidates use same provider (${[...providerNames][0]}). Single point of failure.`);
  }

  // Check 8: wireModel set for all candidates
  const missingWireModel = allModels.filter((m) => models[m] && !models[m].wireModel);
  if (missingWireModel.length === 0) {
    pass('wire_model', 'All models have wireModel defined');
  } else {
    warn('wire_model', `Models missing wireModel (will use name as fallback): ${missingWireModel.join(', ')}`);
  }

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const score = Math.round((passCount / checks.length) * 100);

  return { runtime, role, checks, score };
}

function validateAll(config) {
  const routes = unwrapMap(config.routing, 'routes');
  const results = [];

  for (const [runtimeName, runtimeConfig] of Object.entries(routes)) {
    if (runtimeName === 'default') continue;
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;

    for (const [roleName, roleConfig] of Object.entries(runtimeConfig)) {
      if (['runtime', 'inherits'].includes(roleName)) continue;
      if (typeof roleConfig !== 'object' || Array.isArray(roleConfig)) continue;
      if (!roleConfig.modelChain) continue;

      results.push(validateRoute(runtimeName, roleName, config));
    }
  }

  return results;
}

function formatValidationOutput(results) {
  const lines = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;

  for (const r of results) {
    lines.push(`\n── ${r.runtime}/${r.role} (score: ${r.score}%) ──`);
    for (const c of r.checks) {
      const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚠️';
      lines.push(`  ${icon} ${c.name}: ${c.detail}`);
      if (c.status === 'pass') totalPass++;
      else if (c.status === 'fail') totalFail++;
      else totalWarn++;
    }
  }

  lines.push(`\n── Summary ──`);
  lines.push(`  Routes validated: ${results.length}`);
  lines.push(`  Checks: ${totalPass} pass, ${totalWarn} warn, ${totalFail} fail`);

  const overallScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0;
  lines.push(`  Overall score: ${overallScore}%`);

  if (totalFail > 0) {
    lines.push(`\n  ❌ VALIDATION FAILED — ${totalFail} check(s) failed`);
  } else if (totalWarn > 0) {
    lines.push(`\n  ⚠️  VALIDATION PASSED with ${totalWarn} warning(s)`);
  } else {
    lines.push(`\n  ✅ VALIDATION PASSED — all checks green`);
  }

  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: ai-router <command> [options]');
    console.error('Commands:');
    console.error('  resolve  --runtime <runtime> --role <role>');
    console.error('  validate [--runtime <runtime> --role <role>] [--json] [--all]');
    process.exit(1);
  }

  const command = argv[0];
  const configDir = process.env.AI_ROUTER_CONFIG_DIR || DEFAULT_CONFIG_DIR;
  const config = loadAllConfigs(configDir);

  if (command === 'resolve') {
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

    const result = resolveRoute(runtime, role, config);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  } else if (command === 'validate') {
    const parsed = parseArgs({
      args: argv.slice(1),
      options: {
        runtime: { type: 'string' },
        role: { type: 'string' },
        all: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    });

    if (parsed.values.help) {
      console.error('Usage: validate [--runtime <runtime> --role <role>] [--all] [--json]');
      console.error('  --all: validate all defined routes');
      console.error('  --json: output as JSON');
      process.exit(0);
    }

    let results;
    if (parsed.values.all || (!parsed.values.runtime && !parsed.values.role)) {
      results = validateAll(config);
    } else {
      if (!parsed.values.runtime || !parsed.values.role) {
        console.error('Error: both --runtime and --role are required (or use --all)');
        process.exit(1);
      }
      results = [validateRoute(parsed.values.runtime, parsed.values.role, config)];
    }

    if (parsed.values.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
      process.stdout.write(formatValidationOutput(results) + '\n');
    }

    const hasFail = results.some((r) => r.checks.some((c) => c.status === 'fail'));
    process.exit(hasFail ? 1 : 0);

  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
