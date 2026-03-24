const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function runResolve(runtime, role) {
  const result = spawnSync('node', ['src/cli.js', 'resolve', '--runtime', runtime, '--role', role], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

// ── Gastown routes ──────────────────────────────────────────────────

test('resolve returns gastown polecat primary route', () => {
  const resolved = runResolve('gastown', 'polecat');
  assert.equal(resolved.runtime, 'gastown');
  assert.equal(resolved.role, 'polecat');
  assert.equal(resolved.provider, 'ep38');
  assert.equal(resolved.model, 'glm-4.7');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
  assert.deepEqual(
    resolved.runtimeEnv.map((entry) => entry.name),
    ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_API_KEY']
  );
  assert.equal(resolved.auth.env, 'EP38_API_KEY');
});

test('resolve returns gastown crew fallback chain from central route', () => {
  const resolved = runResolve('gastown', 'crew');
  assert.equal(resolved.runtime, 'gastown');
  assert.equal(resolved.role, 'crew');
  assert.equal(resolved.provider, 'ep38');
  assert.equal(resolved.model, 'glm-5');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns gastown mayor route (glm-5 primary)', () => {
  const resolved = runResolve('gastown', 'mayor');
  assert.equal(resolved.model, 'glm-5');
  assert.deepEqual(resolved.fallbacks, ['MiniMax-M2.5', 'glm-4.7', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns gastown witness route (glm-4.7 primary)', () => {
  const resolved = runResolve('gastown', 'witness');
  assert.equal(resolved.model, 'glm-4.7');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

// ── AI Router routes ────────────────────────────────────────────────

test('resolve returns ai_router crew/router_core route', () => {
  const resolved = runResolve('ai_router', 'crew/router_core');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'crew/router_core');
  assert.equal(resolved.model, 'glm-5');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.ai_router.crew/router_core');
  assert.deepEqual(resolved.fallbacks, ['MiniMax-M2.5', 'glm-4.7', 'kimi-k2.5', 'glm-4']);
});

test('resolve inherits gastown polecat route into ai_router runtime', () => {
  const resolved = runResolve('ai_router', 'polecat');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'polecat');
  assert.equal(resolved.model, 'glm-4.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.polecat');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.ai_router.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve inherits gastown crew fallback chain into ai_router generic crew', () => {
  const resolved = runResolve('ai_router', 'crew');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'crew');
  assert.equal(resolved.model, 'glm-5');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.ai_router.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve falls back from ai_router crew subrole to inherited generic crew route', () => {
  const resolved = runResolve('ai_router', 'crew/sop_watchdog');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'crew/sop_watchdog');
  assert.equal(resolved.model, 'glm-5');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.ai_router.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

// ── Coworker routes (contract for P2 sandbox work) ─────────────────

test('resolve returns coworker default route (glm-5 primary)', () => {
  const resolved = runResolve('coworker', 'default');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'default');
  assert.equal(resolved.provider, 'ep38');
  assert.equal(resolved.model, 'glm-5');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.coworker.default');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns coworker crew route (inherits gastown crew)', () => {
  const resolved = runResolve('coworker', 'crew');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'crew');
  assert.equal(resolved.model, 'glm-5');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns coworker crew/coworker via inherited generic crew route', () => {
  const resolved = runResolve('coworker', 'crew/coworker');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'crew/coworker');
  assert.equal(resolved.model, 'glm-5');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns coworker boot route (glm-5 primary)', () => {
  const resolved = runResolve('coworker', 'boot');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'boot');
  assert.equal(resolved.model, 'glm-5');
  assert.deepEqual(resolved.fallbacks, ['glm-4.7', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns coworker witness route (glm-4.7 primary)', () => {
  const resolved = runResolve('coworker', 'witness');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'witness');
  assert.equal(resolved.model, 'glm-4.7');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns coworker refinery route (glm-4.7 primary)', () => {
  const resolved = runResolve('coworker', 'refinery');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'refinery');
  assert.equal(resolved.model, 'glm-4.7');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

test('resolve returns coworker polecat route (glm-4.7 primary)', () => {
  const resolved = runResolve('coworker', 'polecat');
  assert.equal(resolved.runtime, 'coworker');
  assert.equal(resolved.role, 'polecat');
  assert.equal(resolved.model, 'glm-4.7');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.5', 'kimi-k2.5', 'glm-4']);
});

// ── Config integrity ────────────────────────────────────────────────

test('fallback config only keeps minimax/glm/kimi families', () => {
  const fallbackConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'configs', 'fallbacks.json'), 'utf8')
  ).fallbacks;

  const allTargets = Object.values(fallbackConfig).flat();
  assert.ok(allTargets.length > 0);
  for (const model of allTargets) {
    assert.match(model, /^(MiniMax-|glm-|kimi-)/, `unexpected fallback target: ${model}`);
    assert.doesNotMatch(model, /claude|gpt|openai|llama|qwen/i, `forbidden fallback target: ${model}`);
  }
});

test('coworker runtime has all required roles defined', () => {
  const routingConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'configs', 'routing.json'), 'utf8')
  );
  const coworkerRoutes = routingConfig.routes.coworker;
  assert.ok(coworkerRoutes, 'coworker runtime must exist in routing.json');
  assert.equal(coworkerRoutes.inherits, 'gastown', 'coworker must inherit from gastown');

  const requiredRoles = ['default', 'boot', 'witness', 'refinery', 'polecat'];
  for (const role of requiredRoles) {
    assert.ok(coworkerRoutes[role], `coworker must define role: ${role}`);
    assert.ok(
      Array.isArray(coworkerRoutes[role].modelChain) && coworkerRoutes[role].modelChain.length >= 3,
      `coworker.${role} must have at least 3 candidates in modelChain`
    );
  }
});

test('all coworker model chains only reference known models', () => {
  const routingConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'configs', 'routing.json'), 'utf8')
  );
  const modelsConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'configs', 'models.json'), 'utf8')
  );
  const knownModels = new Set(Object.keys(modelsConfig.models));
  const coworkerRoutes = routingConfig.routes.coworker;

  for (const [role, route] of Object.entries(coworkerRoutes)) {
    if (typeof route !== 'object' || Array.isArray(route) || !route.modelChain) continue;
    for (const model of route.modelChain) {
      assert.ok(knownModels.has(model), `coworker.${role} references unknown model: ${model}`);
    }
  }
});
