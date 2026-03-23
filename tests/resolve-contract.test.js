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

test('resolve returns gastown polecat primary route', () => {
  const resolved = runResolve('gastown', 'polecat');
  assert.equal(resolved.runtime, 'gastown');
  assert.equal(resolved.role, 'polecat');
  assert.equal(resolved.provider, 'ep38');
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
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
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
});

test('resolve returns quant scout route', () => {
  const resolved = runResolve('quant', 'crew/scout');
  assert.equal(resolved.runtime, 'quant');
  assert.equal(resolved.role, 'crew/scout');
  assert.equal(resolved.model, 'glm-4.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.quant.crew/scout');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'MiniMax-M2.7']);
});

test('resolve falls back from unknown quant crew subrole to inherited gastown crew chain', () => {
  const resolved = runResolve('quant', 'crew/sop_watchdog');
  assert.equal(resolved.runtime, 'quant');
  assert.equal(resolved.role, 'crew/sop_watchdog');
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.quant.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
});

test('resolve returns ai_router crew route', () => {
  const resolved = runResolve('ai_router', 'crew/router_core');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'crew/router_core');
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.ai_router.crew/router_core');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
});

test('resolve inherits gastown polecat route into ai_router runtime', () => {
  const resolved = runResolve('ai_router', 'polecat');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'polecat');
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.polecat');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.ai_router.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
});

test('resolve inherits gastown crew fallback chain into ai_router generic crew', () => {
  const resolved = runResolve('ai_router', 'crew');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'crew');
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.ai_router.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
});

test('resolve falls back from ai_router crew subrole to inherited generic crew route', () => {
  const resolved = runResolve('ai_router', 'crew/sop_watchdog');
  assert.equal(resolved.runtime, 'ai_router');
  assert.equal(resolved.role, 'crew/sop_watchdog');
  assert.equal(resolved.model, 'MiniMax-M2.7');
  assert.equal(resolved.source.route, 'configs/routing.json#routes.gastown.crew');
  assert.equal(resolved.source.inheritedFrom, 'configs/routing.json#routes.ai_router.inherits');
  assert.deepEqual(resolved.fallbacks, ['glm-5', 'glm-4.7']);
});

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
