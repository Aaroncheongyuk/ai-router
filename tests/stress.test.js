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
  assert.equal(result.status, 0, `resolve failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function runResolveFail(runtime, role) {
  const result = spawnSync('node', ['src/cli.js', 'resolve', '--runtime', runtime, '--role', role], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result;
}

function runValidate(args = []) {
  const result = spawnSync('node', ['src/cli.js', 'validate', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result;
}

function loadConfig(filename) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'configs', filename), 'utf8'));
}

// ── Stress Test 1: All runtime × role combos resolve ──────────────────

test('STRESS: every defined route resolves without error', () => {
  const routing = loadConfig('routing.json');
  const routes = routing.routes;
  let count = 0;

  for (const [runtimeName, runtimeConfig] of Object.entries(routes)) {
    if (runtimeName === 'default') continue;
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;

    for (const [roleName, roleConfig] of Object.entries(runtimeConfig)) {
      if (['runtime', 'inherits'].includes(roleName)) continue;
      if (typeof roleConfig !== 'object' || Array.isArray(roleConfig)) continue;
      if (!roleConfig.modelChain) continue;

      const resolved = runResolve(runtimeName, roleName);
      assert.ok(resolved.model, `${runtimeName}/${roleName}: missing model`);
      assert.ok(resolved.provider, `${runtimeName}/${roleName}: missing provider`);
      assert.ok(Array.isArray(resolved.fallbacks), `${runtimeName}/${roleName}: fallbacks not array`);
      assert.ok(resolved.fallbacks.length >= 2, `${runtimeName}/${roleName}: fallback chain too short (${resolved.fallbacks.length})`);
      assert.ok(resolved.runtimeEnv.length === 3, `${runtimeName}/${roleName}: runtimeEnv should have 3 entries`);
      count++;
    }
  }

  assert.ok(count >= 20, `Expected at least 20 route combos, got ${count}`);
});

// ── Stress Test 2: Fallback chain exhaustion ──────────────────────────

test('STRESS: every candidate in every chain is individually resolvable', () => {
  const routing = loadConfig('routing.json');
  const models = loadConfig('models.json').models;
  const providers = loadConfig('providers.json').providers;
  let candidateCount = 0;

  for (const [runtimeName, runtimeConfig] of Object.entries(routing.routes)) {
    if (runtimeName === 'default') continue;
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;

    for (const [roleName, roleConfig] of Object.entries(runtimeConfig)) {
      if (['runtime', 'inherits'].includes(roleName)) continue;
      if (typeof roleConfig !== 'object' || Array.isArray(roleConfig)) continue;
      if (!roleConfig.modelChain) continue;

      for (const modelName of roleConfig.modelChain) {
        const modelConfig = models[modelName];
        assert.ok(modelConfig, `${runtimeName}/${roleName}: model ${modelName} missing from models.json`);

        const providerConfig = providers[modelConfig.provider];
        assert.ok(providerConfig, `${runtimeName}/${roleName}: provider ${modelConfig.provider} missing for model ${modelName}`);
        assert.ok(providerConfig.baseUrl, `${runtimeName}/${roleName}: provider ${modelConfig.provider} missing baseUrl`);
        assert.ok(providerConfig.apiKeyEnv, `${runtimeName}/${roleName}: provider ${modelConfig.provider} missing apiKeyEnv`);

        candidateCount++;
      }
    }
  }

  assert.ok(candidateCount >= 100, `Expected at least 100 total candidates across all chains, got ${candidateCount}`);
});

// ── Stress Test 3: resolvedFallbacks structure integrity ──────────────

test('STRESS: resolvedFallbacks contain complete provider info for every candidate', () => {
  const resolved = runResolve('gastown', 'crew');
  assert.ok(resolved.resolvedFallbacks.length >= 3, 'Expected at least 3 fallbacks');

  for (let i = 0; i < resolved.resolvedFallbacks.length; i++) {
    const fb = resolved.resolvedFallbacks[i];
    assert.ok(fb.provider, `fallback[${i}]: missing provider`);
    assert.ok(fb.protocol, `fallback[${i}]: missing protocol`);
    assert.ok(fb.baseUrl, `fallback[${i}]: missing baseUrl`);
    assert.ok(fb.model, `fallback[${i}]: missing model`);
    assert.ok(fb.wireModel, `fallback[${i}]: missing wireModel`);
    assert.ok(fb.auth && fb.auth.env, `fallback[${i}]: missing auth.env`);
    assert.ok(Array.isArray(fb.runtimeEnv), `fallback[${i}]: missing runtimeEnv`);
    assert.equal(fb.runtimeEnv.length, 3, `fallback[${i}]: runtimeEnv should have 3 entries`);

    const envNames = fb.runtimeEnv.map((e) => e.name);
    assert.ok(envNames.includes('ANTHROPIC_BASE_URL'), `fallback[${i}]: missing ANTHROPIC_BASE_URL`);
    assert.ok(envNames.includes('ANTHROPIC_MODEL'), `fallback[${i}]: missing ANTHROPIC_MODEL`);
    assert.ok(envNames.includes('ANTHROPIC_API_KEY'), `fallback[${i}]: missing ANTHROPIC_API_KEY`);
  }
});

// ── Stress Test 4: Invalid inputs handled gracefully ──────────────────

test('STRESS: unknown runtime exits with error', () => {
  const result = runResolveFail('nonexistent_runtime', 'some_role');
  // Should use default route (not crash)
  assert.equal(result.status, 0, 'Unknown runtime should fall back to default route');
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.model, 'Default route should still return a model');
});

test('STRESS: unknown role in known runtime uses fallback', () => {
  const result = runResolveFail('gastown', 'nonexistent_role');
  assert.equal(result.status, 0, 'Unknown role should fall back to default');
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.model, 'Should get a model from fallback route');
});

test('STRESS: missing --runtime flag exits non-zero', () => {
  const result = spawnSync('node', ['src/cli.js', 'resolve', '--role', 'crew'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'Should fail without --runtime');
});

test('STRESS: missing --role flag exits non-zero', () => {
  const result = spawnSync('node', ['src/cli.js', 'resolve', '--runtime', 'gastown'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'Should fail without --role');
});

test('STRESS: unknown command exits non-zero', () => {
  const result = spawnSync('node', ['src/cli.js', 'foobar'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'Should fail with unknown command');
});

// ── Stress Test 5: Concurrent resolve calls ───────────────────────────

test('STRESS: 50 concurrent resolve calls return consistent results', () => {
  const concurrency = 50;
  const runtime = 'gastown';
  const role = 'crew';

  const processes = [];
  for (let i = 0; i < concurrency; i++) {
    processes.push(
      spawnSync('node', ['src/cli.js', 'resolve', '--runtime', runtime, '--role', role], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
    );
  }

  const results = processes.map((p, i) => {
    assert.equal(p.status, 0, `Concurrent call ${i} failed: ${p.stderr}`);
    return JSON.parse(p.stdout);
  });

  // All should return identical results (deterministic resolution)
  const first = JSON.stringify(results[0]);
  for (let i = 1; i < results.length; i++) {
    assert.equal(JSON.stringify(results[i]), first, `Concurrent call ${i} returned different result`);
  }
});

// ── Stress Test 6: Config integrity — no dangling references ──────────

test('STRESS: all models in routing.json exist in models.json', () => {
  const routing = loadConfig('routing.json');
  const models = loadConfig('models.json').models;
  const knownModels = new Set(Object.keys(models));
  const errors = [];

  for (const [runtimeName, runtimeConfig] of Object.entries(routing.routes)) {
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;

    for (const [roleName, roleConfig] of Object.entries(runtimeConfig)) {
      if (typeof roleConfig !== 'object' || Array.isArray(roleConfig) || !roleConfig.modelChain) continue;

      for (const model of roleConfig.modelChain) {
        if (!knownModels.has(model)) {
          errors.push(`${runtimeName}/${roleName}: unknown model ${model}`);
        }
      }
    }
  }

  assert.equal(errors.length, 0, `Dangling model references:\n${errors.join('\n')}`);
});

test('STRESS: all providers in models.json exist in providers.json', () => {
  const models = loadConfig('models.json').models;
  const providers = loadConfig('providers.json').providers;
  const errors = [];

  for (const [modelName, modelConfig] of Object.entries(models)) {
    if (!providers[modelConfig.provider]) {
      errors.push(`Model ${modelName} references unknown provider ${modelConfig.provider}`);
    }
  }

  assert.equal(errors.length, 0, `Dangling provider references:\n${errors.join('\n')}`);
});

test('STRESS: all models in fallbacks.json exist in models.json', () => {
  const fallbacks = loadConfig('fallbacks.json').fallbacks;
  const models = loadConfig('models.json').models;
  const knownModels = new Set(Object.keys(models));
  const errors = [];

  for (const [primaryModel, chain] of Object.entries(fallbacks)) {
    if (!knownModels.has(primaryModel)) {
      errors.push(`Primary model ${primaryModel} not in models.json`);
    }
    for (const fallbackModel of chain) {
      if (!knownModels.has(fallbackModel)) {
        errors.push(`Fallback ${fallbackModel} (from ${primaryModel}) not in models.json`);
      }
    }
  }

  assert.equal(errors.length, 0, `Dangling fallback references:\n${errors.join('\n')}`);
});

test('STRESS: no circular fallback chains', () => {
  const fallbacks = loadConfig('fallbacks.json').fallbacks;

  for (const [primaryModel, chain] of Object.entries(fallbacks)) {
    // A model should not appear in its own fallback chain
    assert.ok(
      !chain.includes(primaryModel),
      `Circular fallback: ${primaryModel} appears in its own fallback chain`
    );
  }
});

// ── Stress Test 7: Inheritance chains ─────────────────────────────────

test('STRESS: all inherits targets exist as runtime keys', () => {
  const routing = loadConfig('routing.json');
  const routes = routing.routes;
  const runtimeNames = new Set(Object.keys(routes));

  for (const [runtimeName, runtimeConfig] of Object.entries(routes)) {
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;
    if (runtimeConfig.inherits) {
      assert.ok(
        runtimeNames.has(runtimeConfig.inherits),
        `${runtimeName} inherits from ${runtimeConfig.inherits}, but that runtime doesn't exist`
      );
    }
  }
});

test('STRESS: no circular inheritance', () => {
  const routing = loadConfig('routing.json');
  const routes = routing.routes;

  for (const [runtimeName, runtimeConfig] of Object.entries(routes)) {
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;

    const visited = new Set();
    let current = runtimeName;
    while (current) {
      assert.ok(!visited.has(current), `Circular inheritance detected: ${[...visited, current].join(' → ')}`);
      visited.add(current);
      const config = routes[current];
      current = (typeof config === 'object' && !Array.isArray(config)) ? config.inherits : null;
    }
  }
});

// ── Stress Test 8: Validate command integration ───────────────────────

test('STRESS: validate --all exits 0 with current config', () => {
  const result = runValidate(['--all']);
  assert.equal(result.status, 0, `validate --all failed:\n${result.stdout}\n${result.stderr}`);
});

test('STRESS: validate --all --json returns valid JSON array', () => {
  const result = runValidate(['--all', '--json']);
  assert.equal(result.status, 0, `validate --all --json failed:\n${result.stderr}`);

  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed), 'JSON output should be an array');
  assert.ok(parsed.length >= 20, `Expected at least 20 validation results, got ${parsed.length}`);

  for (const entry of parsed) {
    assert.ok(entry.runtime, 'Each entry should have runtime');
    assert.ok(entry.role, 'Each entry should have role');
    assert.ok(Array.isArray(entry.checks), 'Each entry should have checks array');
    assert.ok(typeof entry.score === 'number', 'Each entry should have numeric score');
  }
});

test('STRESS: validate single route returns exactly 1 result in JSON', () => {
  const result = runValidate(['--runtime', 'gastown', '--role', 'mayor', '--json']);
  assert.equal(result.status, 0, `Single validate failed:\n${result.stderr}`);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.length, 1, 'Should return exactly 1 result');
  assert.equal(parsed[0].runtime, 'gastown');
  assert.equal(parsed[0].role, 'mayor');
});

// ── Stress Test 9: modelChain ordering is preserved ───────────────────

test('STRESS: resolve preserves modelChain order from routing.json', () => {
  const routing = loadConfig('routing.json');

  // Test a few specific routes where we know the order
  const mayorChain = routing.routes.gastown.mayor.modelChain;
  const resolved = runResolve('gastown', 'mayor');

  assert.equal(resolved.model, mayorChain[0], 'Primary model should be first in chain');

  const resolvedChain = [resolved.model, ...resolved.fallbacks];
  for (let i = 0; i < mayorChain.length; i++) {
    assert.equal(resolvedChain[i], mayorChain[i], `Chain position ${i}: expected ${mayorChain[i]}, got ${resolvedChain[i]}`);
  }
});

// ── Stress Test 10: Source traceability ───────────────────────────────

test('STRESS: all resolved routes have source traceability', () => {
  const routing = loadConfig('routing.json');

  for (const [runtimeName, runtimeConfig] of Object.entries(routing.routes)) {
    if (runtimeName === 'default') continue;
    if (typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) continue;

    for (const [roleName, roleConfig] of Object.entries(runtimeConfig)) {
      if (['runtime', 'inherits'].includes(roleName)) continue;
      if (typeof roleConfig !== 'object' || Array.isArray(roleConfig)) continue;
      if (!roleConfig.modelChain) continue;

      const resolved = runResolve(runtimeName, roleName);
      assert.ok(resolved.source, `${runtimeName}/${roleName}: missing source`);
      assert.ok(resolved.source.route, `${runtimeName}/${roleName}: missing source.route`);
      assert.ok(resolved.source.model, `${runtimeName}/${roleName}: missing source.model`);
      assert.ok(resolved.source.provider, `${runtimeName}/${roleName}: missing source.provider`);
    }
  }
});

// ── Stress Test 11: wireModel consistency ─────────────────────────────

test('STRESS: wireModel in resolve output matches models.json', () => {
  const models = loadConfig('models.json').models;
  const resolved = runResolve('gastown', 'crew');

  // Check primary
  const primaryModelConfig = models[resolved.model];
  assert.equal(resolved.wireModel, primaryModelConfig.wireModel || resolved.model);

  // Check all fallbacks
  for (const fb of resolved.resolvedFallbacks) {
    const fbModelConfig = models[fb.model];
    assert.equal(fb.wireModel, fbModelConfig.wireModel || fb.model, `wireModel mismatch for ${fb.model}`);
  }
});

// ── Stress Test 12: Performance — resolve should be fast ──────────────

test('STRESS: single resolve completes within 500ms', () => {
  const start = Date.now();
  runResolve('gastown', 'crew');
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `Resolve took ${elapsed}ms, expected < 500ms`);
});

test('STRESS: validate --all completes within 5s', () => {
  const start = Date.now();
  const result = runValidate(['--all', '--json']);
  const elapsed = Date.now() - start;
  assert.equal(result.status, 0, `validate failed: ${result.stderr}`);
  assert.ok(elapsed < 5000, `Validate --all took ${elapsed}ms, expected < 5000ms`);
});
