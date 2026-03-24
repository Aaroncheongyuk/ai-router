const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

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
  const hasExplicitStateRoot = Object.prototype.hasOwnProperty.call(env, 'AI_ROUTER_STATE_ROOT');
  const hasExplicitTownRoot = Object.prototype.hasOwnProperty.call(env, 'AI_ROUTER_TOWN_ROOT');
  const stateRoot = hasExplicitStateRoot || hasExplicitTownRoot
    ? undefined
    : fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-wrapper-test-state-'));
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

  const result = spawnSync('bash', [path.join(repoRoot, 'wrappers', 'claude-38')], {
    cwd,
    encoding: 'utf8',
    env: {
      ...cleanEnv,
      ...(stateRoot ? { AI_ROUTER_STATE_ROOT: stateRoot } : {}),
      ...env,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return parseEnvOutput(result.stdout);
}

test('wrapper exports resolved anthropic-compatible env', () => {
  const env = runWrapper({
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
    AI_ROUTER_DEBUG: '1',
  });

  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
  assert.equal(env.AI_ROUTER_SELECTED_PROVIDER, 'ep38');
  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '0');
  assert.equal(env.ANTHROPIC_API_KEY, 'dummy-key');
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.apitoken.ai');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
});

test('wrapper increments target index after recoverable failure', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-recovery-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'recover-me.json'),
    JSON.stringify({ target_index: 0, exit_class: 'provider_recoverable' })
  );

  const env = runWrapper({
    GT_SESSION: 'recover-me',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '1');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-5');
});

test('wrapper treats context-window overflow as recoverable for fallback selection', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-context-overflow-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'context-overflow.json'),
    JSON.stringify({ target_index: 0, exit_class: 'context_window_recoverable' })
  );

  const env = runWrapper({
    GT_SESSION: 'context-overflow',
    GT_ROLE: 'sora_hk_sdwan/crew/simulation_harness',
    AI_ROUTER_RUNTIME: 'gastown',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '1');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
});

test('wrapper maps real gastown rig env to gastown runtime routes', () => {
  const env = runWrapper({
    GT_RIG: 'testrig',
    GT_ROLE: 'testrig/crew/worker1',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'gastown');
  assert.equal(env.AI_ROUTER_RESOLVED_ROLE, 'crew');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
});

test('wrapper preserves ai_router crew subrole when resolving route', () => {
  const env = runWrapper({
    GT_RIG: 'ai_router',
    GT_ROLE: 'ai_router/crew/router_core',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'ai_router');
  assert.equal(env.AI_ROUTER_RESOLVED_ROLE, 'crew/router_core');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
});

test('wrapper preserves quant crew subrole and resolves quant scout route', () => {
  const env = runWrapper({
    GT_RIG: 'quant',
    GT_ROLE: 'quant/crew/scout',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  // quant is not a defined runtime, falls back to gastown default
  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'gastown');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-5');
});

test('wrapper falls back from unknown quant crew subrole to inherited gastown crew chain', () => {
  const env = runWrapper({
    GT_RIG: 'quant',
    GT_ROLE: 'quant/crew/sop_watchdog',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'gastown');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
});

test('wrapper falls back from ai_router watchdog subrole to central crew chain', () => {
  const env = runWrapper({
    GT_RIG: 'ai_router',
    GT_ROLE: 'ai_router/crew/sop_watchdog',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_RESOLVED_RUNTIME, 'ai_router');
  assert.equal(env.AI_ROUTER_RESOLVED_ROLE, 'crew/sop_watchdog');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-5');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-5');
});

test('wrapper advances gastown crew after recoverable failure when fallback candidates exist', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-crew-fallback-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'crew-fallback.json'),
    JSON.stringify({ target_index: 0, exit_class: 'rate_limit' })
  );

  const env = runWrapper({
    GT_SESSION: 'crew-fallback',
    GT_ROLE: 'sora_hk_sdwan/crew/simulation_harness',
    AI_ROUTER_RUNTIME: 'gastown',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '1');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
  assert.equal(env.AI_ROUTER_CANDIDATE_COUNT, '5');
});

test('wrapper advances after generic runtime errors instead of requiring a specific error code', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-runtime-error-fallback-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'runtime-error.json'),
    JSON.stringify({ target_index: 1, exit_class: 'runtime_error' })
  );

  const env = runWrapper({
    GT_SESSION: 'runtime-error',
    GT_ROLE: 'sora_hk_sdwan/crew/simulation_harness',
    AI_ROUTER_RUNTIME: 'gastown',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '2');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'MiniMax-M2.5');
  assert.equal(env.ANTHROPIC_MODEL, 'MiniMax-M2.5');
});

test('explicit target-model pin overrides auto-recovery fallback selection', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-pinned-model-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'pinned-model.json'),
    JSON.stringify({ target_index: 0, exit_class: 'context_window_recoverable' })
  );

  const env = runWrapper({
    GT_SESSION: 'pinned-model',
    GT_ROLE: 'sora_hk_sdwan/crew/simulation_harness',
    AI_ROUTER_RUNTIME: 'gastown',
    AI_ROUTER_TARGET_MODEL: 'MiniMax-M2.5',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'MiniMax-M2.5');
  assert.equal(env.ANTHROPIC_MODEL, 'MiniMax-M2.5');
});

test('wrapper loads quoted EP38_API_KEY from local .env', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-env-'));
  fs.writeFileSync(path.join(workDir, '.env'), 'EP38_API_KEY="quoted-secret"\n');

  const result = spawnSync('bash', [path.join(repoRoot, 'wrappers', 'claude-38')], {
    cwd: workDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      UNDERLYING_CLAUDE_BIN: 'env',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const env = parseEnvOutput(result.stdout);
  assert.equal(env.ANTHROPIC_API_KEY, 'quoted-secret');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
});

test('wrapper preserves injected AI_ROUTER_TOWN_ROOT for gastown crew metadata pathing', () => {
  const crewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-injected-town-root-'));
  const townRoot = path.join(crewDir, '..', 'authoritative-town-root');
  fs.mkdirSync(townRoot, { recursive: true });

  const env = runWrapper({
    GT_SESSION: 'injected-town-root',
    GT_ROLE: 'coworker/crew/pressure_test',
    AI_ROUTER_TOWN_ROOT: townRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  }, crewDir);

  assert.equal(env.AI_ROUTER_STATE_ROOT, path.join(townRoot, '.runtime', 'ai-router'));
});

test('wrapper finds outermost town root from nested gastown crew worktree paths', () => {
  const townRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-outermost-town-root-'));
  const nestedCrewDir = path.join(townRoot, 'alpha', 'crew', 'worker');
  fs.mkdirSync(path.join(townRoot, 'mayor'), { recursive: true });
  fs.writeFileSync(path.join(townRoot, 'mayor', 'town.json'), '{}\n');
  fs.mkdirSync(path.join(nestedCrewDir, 'mayor'), { recursive: true });
  fs.writeFileSync(path.join(nestedCrewDir, 'mayor', 'town.json'), '{}\n');

  const env = runWrapper({
    GT_SESSION: 'outermost-town-root',
    GT_ROLE: 'alpha/crew/worker',
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
    // Prevent inherited env from bypassing find_town_root discovery
    AI_ROUTER_TOWN_ROOT: '',
    GT_TOWN_ROOT: '',
    AI_ROUTER_STATE_ROOT: '',
  }, nestedCrewDir);

  assert.equal(env.AI_ROUTER_STATE_ROOT, path.join(townRoot, '.runtime', 'ai-router'));
});

test('wrapper advances ai_router watchdog subrole after recoverable failure on central crew chain', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-router-watchdog-central-chain-'));
  fs.mkdirSync(path.join(stateRoot, 'exit'), { recursive: true });
  fs.writeFileSync(
    path.join(stateRoot, 'exit', 'watchdog-central.json'),
    JSON.stringify({ target_index: 0, exit_class: 'rate_limit' })
  );

  const env = runWrapper({
    GT_SESSION: 'watchdog-central',
    GT_ROLE: 'ai_router/crew/sop_watchdog',
    AI_ROUTER_STATE_ROOT: stateRoot,
    EP38_API_KEY: 'dummy-key',
    UNDERLYING_CLAUDE_BIN: 'env',
  });

  assert.equal(env.AI_ROUTER_SELECTED_TARGET_INDEX, '1');
  assert.equal(env.AI_ROUTER_SELECTED_MODEL, 'glm-4.7');
  assert.equal(env.ANTHROPIC_MODEL, 'glm-4.7');
});
