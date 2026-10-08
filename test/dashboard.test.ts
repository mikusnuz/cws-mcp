import assert from 'node:assert/strict';
import test from 'node:test';
import { updateDashboardMetadata, validateDashboardUpdate } from '../src/dashboard.js';

function dashboard(options: { categoryMissing?: boolean; optionMissing?: boolean; saveMissing?: boolean; persist?: boolean } = {}) {
  const stored = { Description: 'Old description', Category: 'Productivity', 'Homepage URL': 'https://old.example', 'Support URL': '' };
  let draft = { ...stored };
  let saves = 0;
  let reviewClicks = 0;
  let hydrated = true;
  const locator = (key: string, exists = true): any => ({
    count: async () => exists && hydrated ? 1 : 0,
    first() { return this; },
    inputValue: async () => draft[key as keyof typeof draft] ?? '',
    innerText: async () => draft[key as keyof typeof draft] ?? '',
    fill: async (value: string) => { draft[key as keyof typeof draft] = value; },
    isEnabled: async () => true,
    evaluate: async () => false,
    waitFor: async () => { if (!exists) throw new Error('Element visibility timed out'); hydrated = true; },
    click: async () => {
      if (key === 'Save') { saves++; if (options.persist !== false) Object.assign(stored, draft); }
      if (key === 'Submit for review') reviewClicks++;
      if (key === 'Developer Tools') draft.Category = key;
    },
  });
  const page: any = {
    getByLabel: (pattern: RegExp) => {
      const key = Object.keys(draft).find(key => pattern.test(key));
      return locator(key ?? '', !!key);
    },
    getByRole: (role: string, query: { name: string | RegExp }) => {
      if (role === 'combobox') return locator('Category', !options.categoryMissing);
      if (role === 'option') return locator(String(query.name), !options.optionMissing);
      if (role === 'button') {
        const name = options.saveMissing ? 'Submit for review' : 'Save';
        return locator(name, query.name instanceof RegExp ? query.name.test(name) : query.name === name);
      }
      return locator('', false);
    },
    getByText: () => locator('Saved'),
    reload: async () => { draft = { ...stored }; hydrated = false; },
  };
  return { page, stats: () => ({ saves, reviewClicks, stored }) };
}

test('dashboard updates category and text, saves, and verifies persisted values', async () => {
  const fixture = dashboard();
  const result = await updateDashboardMetadata(fixture.page, { category: 'Developer Tools', description: 'New description', supportUrl: '' });
  assert.equal(result.ok, true);
  assert.equal(fixture.stats().saves, 1);
  assert.deepEqual(result.verified, { description: 'New description', supportUrl: '', category: 'Developer Tools' });
  assert.equal(fixture.stats().reviewClicks, 0);
});

for (const option of ['categoryMissing', 'optionMissing'] as const) {
  test(`missing category control (${option}) fails without saving partial edits`, async () => {
    const fixture = dashboard({ [option]: true });
    await assert.rejects(updateDashboardMetadata(fixture.page, { category: 'Developer Tools', description: 'Changed' }), /Category|category/);
    assert.equal(fixture.stats().saves, 0);
  });
}

test('Save is never substituted with Submit for review', async () => {
  const fixture = dashboard({ saveMissing: true });
  await assert.rejects(updateDashboardMetadata(fixture.page, { description: 'Changed' }), /Save button/);
  assert.equal(fixture.stats().reviewClicks, 0);
  assert.equal(fixture.stats().saves, 0);
});

test('successful click without persisted change is an error', async () => {
  const fixture = dashboard({ persist: false });
  await assert.rejects(updateDashboardMetadata(fixture.page, { description: 'Changed' }), /after reload/);
});

test('unchanged fields are verified without another save or review', async () => {
  const fixture = dashboard();
  const result = await updateDashboardMetadata(fixture.page, { description: 'Old description' });
  assert.equal(result.changed, false);
  assert.equal(fixture.stats().saves, 0);
});

test('unverifiable icon uploads and package fields are rejected before mutation', () => {
  assert.throws(() => validateDashboardUpdate({ storeIconPath: '/icon.png' }), /cannot verify/);
  assert.throws(() => validateDashboardUpdate({ title: 'Title', description: 'Changed' }), /manifest/);
});
