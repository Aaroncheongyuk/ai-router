const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const ENV_ECHO_BIN = path.join(os.tmpdir(), 'ai-router-pi-env-stub.sh');
if (!fs.existsSync(ENV_ECHO_BIN)) {
  fs.writeFileSync(ENV_ECHO_BIN, '#!/bin/sh\nenv\n');
  fs.chmodSync(ENV_ECHO_BIN, 0o755);
}

function parseEnvOutput(stdout) {
  const env = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

function runWrapper(env = {}, cwd = repoRoot) {
  const stateRoot = env.AI_ROUTER_STATE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-pi-test-state-'));

  const keysToRemove = new Set([
    'EP38_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'CLAUDE_API_KEY',
    'FARM_API_KEY', 'GPT_API_KEY'
  ]);
  const cleanEnv = {};
  for (const key of Object.keys(process.env)) {
    if (keysToRemove.has(key)) continue;
    if (key.startsWith('GT_') || key.startsWith('AI_ROUTER_')) continue;
    cleanEnv[key] = process.env[key];
  }
  cleanEnv.GT_PROJECT_ROOT = '';
  cleanEnv.GT_TOWN_ROOT = '';
  cleanEnv.GT_ROOT = '';
  cleanEnv.TMUX = '';
  cleanEnv.TMUX_PANE = '';

  const result = spawnSync('bash', [path.join(repoRoot, 'wrappers', 'pi')], {
    cwd,
    encoding: 'utf8',
    env: {
      ...cleanEnv,
      AI_ROUTER_STATE_ROOT: stateRoot,
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return parseEnvOutput(result.stdout);
}

// --- 1. GT_ROLE parsing tests ---

test('pi wrapper: parses ai_router/crew/xxx to crew/xxx', () => {
  const env = runWrapper({
    GT_SESSION: 'pi-test-ai-router-crew',
    GT_RIG: 'ai_router',
    GT_ROLE: 'ai_router/crew/router_core',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'ai_router');
  assert.equal(env.AI_ROUTER_RESOLVED_ROLE, 'crew/router_core');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
});

test('pi wrapper: parses quant/crew/scout to crew (falls back to gastown)', () => {
  const env = runWrapper({
    GT_SESSION: 'pi-test-quant-crew',
    GT_RIG: 'quant',
    GT_ROLE: 'quant/crew/scout',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  // quant is not a defined runtime, falls back to gastown
  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'gastown');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
});

test('pi wrapper: parses gastown/crew/xxx to crew', () => {
  const env = runWrapper({
    GT_SESSION: 'pi-test-gastown-crew',
    GT_ROLE: 'gastown/crew/test',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'gastown');
  assert.equal(env.AI_ROUTER_RESOLVED_ROLE, 'crew');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
});

// --- 2. Routing resolution tests ---

test('pi wrapper: resolves crew role to correct model/provider', () => {
  const env = runWrapper({
    GT_SESSION: 'pi-test-crew-resolve',
    GT_ROLE: 'ai_router/crew/test',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
  assert.equal(env.AI_ROUTER_SELECTED_PROVIDER, 'ep38');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-5');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.apitoken.ai');
});

test('pi wrapper: resolves polecat role', () => {
  const env = runWrapper({
    GT_SESSION: 'pi-test-polecat',
    GT_ROLE: 'ai_router/polecats/test-polecat',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_RESOLVED_ROLE, 'polecat');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
});

// --- 3. Fallback advancement tests ---

test('pi wrapper: increments target index after rate_limit', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-pi-recovery-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'rate-limit-test.json'),
    JSON.stringify({ target_index: 0, exit_class: 'rate_limit' })
  );

  const env = runWrapper({
    GT_SESSION: 'rate-limit-test',
    GT_ROLE: 'ai_router/crew/test',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '1');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
});

test('pi wrapper: increments after provider_recoverable', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-pi-provider-recover-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'provider-test.json'),
    JSON.stringify({ target_index: 1, exit_class: 'provider_recoverable' })
  );

  const env = runWrapper({
    GT_SESSION: 'provider-test',
    GT_ROLE: 'ai_router/crew/test',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '2');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'MiniMax-M2.5');
});

test('pi wrapper: does not increment after clean_exit', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-pi-clean-exit-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'clean-exit.json'),
    JSON.stringify({ target_index: 1, exit_class: 'clean_exit' })
  );

  const env = runWrapper({
    GT_SESSION: 'clean-exit',
    GT_ROLE: 'ai_router/crew/test',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '1');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
});

// --- 4. Manual override tests ---

test('pi wrapper: respects AI_ROUTER_TARGET_MODEL override', () => {
  const env = runWrapper({
    GT_ROLE: 'ai_router/crew/test',
    AI_ROUTER_TARGET_MODEL: 'glm-5',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '0');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-5');
});

test('pi wrapper: respects AI_ROUTER_TARGET_INDEX override', () => {
  const env = runWrapper({
    GT_ROLE: 'ai_router/crew/test',
    AI_ROUTER_TARGET_INDEX: '2',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '2');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'MiniMax-M2.5');
  assert.equal(env.ANTHROPIC_MODEL, 'MiniMax-M2.5');
});

test('pi wrapper: target_model override takes precedence over exit metadata', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-pi-override-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'override-test.json'),
    JSON.stringify({ target_index: 0, exit_class: 'rate_limit' })
  );

  const env = runWrapper({
    GT_SESSION: 'override-test',
    GT_ROLE: 'ai_router/crew/test',
    AI_ROUTER_TARGET_MODEL: 'MiniMax-M2.5',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'MiniMax-M2.5');
  assert.equal(env.ANTHROPIC_MODEL, 'MiniMax-M2.5');
});

// --- 5. Export verification ---

test('pi wrapper: exports correct environment variables', () => {
  const env = runWrapper({
    GT_SESSION: 'pi-test-export',
    EP38_API_KEY: 'test-key-123',
    UNDERLYING_PI_BIN: ENV_ECHO_BIN,
  });

  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
  assert.equal(env.AI_ROUTER_SELECTED_PROVIDER, 'ep38');
  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '0');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.ANTHROPIC_API_KEY, 'test-key-123');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.apitoken.ai');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
});
