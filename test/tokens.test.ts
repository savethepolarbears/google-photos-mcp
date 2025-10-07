import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';

type TokensModule = typeof import('../src/auth/tokens.js');
type ConfigModule = typeof import('../src/utils/config.js');

let tempRoot: string;
let currentTempDir: string;
let config: ConfigModule['default'];
let saveTokens: TokensModule['saveTokens'];
let getFirstAvailableTokens: TokensModule['getFirstAvailableTokens'];
let getTokens: TokensModule['getTokens'];

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'tokens-tests-root-'));
  process.env.TOKEN_STORAGE_PATH = path.join(tempRoot, 'initial-tokens.json');

  ({ default: config } = await import('../src/utils/config.js'));
  ({ saveTokens, getFirstAvailableTokens, getTokens } = await import('../src/auth/tokens.js'));
});

beforeEach(async () => {
  currentTempDir = await fs.mkdtemp(path.join(tempRoot, 'case-'));
  config.tokens.path = path.join(currentTempDir, 'tokens.json');
});

afterEach(async () => {
  if (currentTempDir) {
    await fs.rm(currentTempDir, { recursive: true, force: true });
  }
});

after(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('saveTokens stamps retrievedAt before persisting data', async () => {
  const userTokens = {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expiry_date: Date.now() + 1000,
  };

  await saveTokens('user-1', userTokens);

  const storedData = JSON.parse(await fs.readFile(config.tokens.path, 'utf-8'));
  assert.equal(typeof storedData['user-1'].retrievedAt, 'number');
  assert.ok(storedData['user-1'].retrievedAt > 0);
});

test('getFirstAvailableTokens returns the most recently saved credentials', async () => {
  await saveTokens('user-old', {
    access_token: 'access-old',
    refresh_token: 'refresh-old',
    expiry_date: Date.now() + 1000,
  });

  await new Promise(resolve => setTimeout(resolve, 10));

  await saveTokens('user-new', {
    access_token: 'access-new',
    refresh_token: 'refresh-new',
    expiry_date: Date.now() + 1000,
  });

  const latestTokens = await getFirstAvailableTokens();
  assert.ok(latestTokens);
  assert.equal(latestTokens?.refresh_token, 'refresh-new');
});

test('getTokens falls back to the newest available credentials when useDefault is true', async () => {
  await saveTokens('user-old', {
    access_token: 'access-old',
    refresh_token: 'refresh-old',
    expiry_date: Date.now() + 1000,
  });

  await new Promise(resolve => setTimeout(resolve, 10));

  await saveTokens('user-new', {
    access_token: 'access-new',
    refresh_token: 'refresh-new',
    expiry_date: Date.now() + 1000,
  });

  const latestTokens = await getTokens('unknown-user', true);
  assert.ok(latestTokens);
  assert.equal(latestTokens?.access_token, 'access-new');
});

