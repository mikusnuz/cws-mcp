import { chromium, type Locator, type Page } from 'playwright';

const textFields = {
  description: ['Description', 'Detailed description', '설명', '상세 설명'],
  homepageUrl: ['Homepage URL', 'Homepage', '홈페이지 URL', '홈페이지'],
  supportUrl: ['Support URL', 'Support', '지원 URL', '지원'],
} as const;

export interface DashboardUpdate {
  description?: string;
  category?: string;
  homepageUrl?: string;
  supportUrl?: string;
  title?: string;
  summary?: string;
  defaultLocale?: string;
  metadata?: Record<string, unknown>;
  storeIconPath?: string;
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelPattern(labels: readonly string[]) {
  return new RegExp(`^(${labels.map(escape).join('|')})(?:\\s*\\*)?$`, 'i');
}

async function textField(page: Page, labels: readonly string[]): Promise<Locator> {
  const pattern = labelPattern(labels);
  for (const candidate of [page.getByLabel(pattern), page.getByRole('textbox', { name: pattern })]) {
    const count = await candidate.count();
    if (count > 1) throw new Error(`Multiple fields match ${labels[0]}; select the intended localization in the dashboard`);
    if (count === 1) return candidate;
  }
  throw new Error(`Unable to locate dashboard field ${labels[0]}; no changes were saved`);
}

async function categoryField(page: Page) {
  const field = page.getByRole('combobox', { name: /^(category|카테고리)(?:\s*\*)?$/i });
  if (await field.count() !== 1) throw new Error('Unable to identify a unique Category selector; no changes were saved');
  return field;
}

async function categoryValue(field: Locator): Promise<string> {
  if (await field.evaluate(element => element.tagName === 'SELECT')) {
    return (await field.locator('option:checked').innerText()).trim();
  }
  const text = (await field.innerText()).trim();
  return text || (await field.inputValue()).trim();
}

export async function readDashboardMetadata(page: Page) {
  const values: Record<string, string> = {};
  for (const [key, labels] of Object.entries(textFields)) {
    values[key] = await (await textField(page, labels)).inputValue();
  }
  values.category = await categoryValue(await categoryField(page));
  return values;
}

export function validateDashboardUpdate(args: DashboardUpdate): void {
  if (args.title !== undefined || args.summary !== undefined || args.defaultLocale !== undefined) {
    throw new Error('title, summary, and defaultLocale are package metadata. Update manifest.json (name, description, default_locale) and localized messages, rebuild the ZIP, then use upload. No dashboard changes were made.');
  }
  if (args.metadata !== undefined) {
    throw new Error('Raw metadata payloads are not supported by Chrome Web Store API v2. Pass description, category, homepageUrl, or supportUrl for a dashboard update.');
  }
  if (args.storeIconPath !== undefined) {
    throw new Error('Store icon upload is not available through the public API and this tool cannot verify its dashboard upload reliably. Upload the icon in the Developer Dashboard. No changes were made.');
  }
  if (![args.description, args.category, args.homepageUrl, args.supportUrl].some(value => value !== undefined)) {
    throw new Error('No supported metadata fields provided');
  }
  if (args.category !== undefined && !args.category.trim()) throw new Error('category must not be empty');
}

export async function updateDashboardMetadata(page: Page, args: DashboardUpdate) {
  validateDashboardUpdate(args);
  const expected: Record<string, string> = {};
  let changed = false;
  for (const [key, labels] of Object.entries(textFields)) {
    const value = args[key as keyof typeof textFields];
    if (value === undefined) continue;
    const field = await textField(page, labels);
    expected[key] = value;
    if (await field.inputValue() !== value) {
      await field.fill(value);
      changed = true;
    }
  }
  if (args.category !== undefined) {
    const field = await categoryField(page);
    expected.category = args.category.trim();
    if (await categoryValue(field) !== expected.category) {
      if (await field.evaluate(element => element.tagName === 'SELECT')) {
        await field.selectOption({ label: expected.category });
      } else {
        await field.click();
        const option = page.getByRole('option', { name: expected.category, exact: true });
        if (await option.count() !== 1) throw new Error(`Category option "${expected.category}" was not found uniquely; no changes were saved`);
        await option.click();
      }
      if (await categoryValue(field) !== expected.category) throw new Error('Category selection did not change; no changes were saved');
      changed = true;
    }
  }
  if (changed) {
    // Saving a listing must never fall back to submitting it for review.
    const save = page.getByRole('button', { name: /^(save|save draft|save changes|저장|임시\s?저장|초안 저장|변경사항 저장)$/i });
    if (await save.count() !== 1 || !await save.isEnabled()) {
      throw new Error('A unique enabled Save button was not found; no submission was attempted');
    }
    await save.click();
    // Only accept an explicit saved state before reloading persisted values.
    await page.getByText(/^(item saved\.?|changes saved\.?|all changes saved\.?|saved\.?|항목이 저장되었습니다\.?|변경사항이 저장되었습니다\.?|저장되었습니다\.?)$/i)
      .first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByRole('combobox', { name: /^(category|카테고리)(?:\s*\*)?$/i })
    .waitFor({ state: 'visible', timeout: 30_000 });
  for (const [key, value] of Object.entries(expected)) {
    const actual = key === 'category'
      ? await categoryValue(await categoryField(page))
      : await (await textField(page, textFields[key as keyof typeof textFields])).inputValue();
    if (actual !== value) throw new Error(`Saved ${key} did not match the requested value after reload; inspect the dashboard before retrying`);
  }
  return { ok: true, mode: 'dashboard-ui', changed, verified: expected };
}

export async function withDashboard<T>(
  options: { itemId: string; profileDir: string; accountIndex?: number; headless?: boolean },
  action: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await chromium.launchPersistentContext(options.profileDir, {
    channel: 'chrome', headless: options.headless ?? false,
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`https://chromewebstore.google.com/u/${options.accountIndex ?? 0}/dashboard/${encodeURIComponent(options.itemId)}/edit`, {
      waitUntil: 'domcontentloaded', timeout: 90_000,
    });
    if (page.url().includes('accounts.google.com')) {
      if (options.headless) throw new Error('Sign in first by calling a dashboard tool with headless=false');
      await page.waitForURL(url => url.hostname === 'chromewebstore.google.com', { timeout: 120_000 });
    }
    await page.getByRole('combobox', { name: /^(category|카테고리)(?:\s*\*)?$/i }).waitFor({ state: 'visible', timeout: 30_000 });
    return await action(page);
  } catch (error) {
    throw new Error(`Dashboard operation could not be verified: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}
