import { expect, test, type BrowserContext, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const SERVER_URL = 'http://ai-setup.test/v1'
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS'
}

async function openGuidedSetup(page: Page) {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-ai').click()
  await page.getByTestId('settings-run-ai-setup').click()
  const setup = page.getByTestId('ai-setup-dialog')
  await expect(setup.getByRole('heading', { name: 'What should AI help with?' })).toBeVisible()
  return setup
}

/** Answers the connection test like an OpenAI-compatible server would. */
async function serveCompatibleModel(page: Page) {
  await page.route(`${SERVER_URL}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    await route.fulfill({
      headers: CORS_HEADERS,
      json: {
        id: 'chatcmpl-ai-setup',
        object: 'chat.completion',
        created: 0,
        model: 'qwen3-coder:30b',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }
    })
  })
}

test('guided setup opens from AI settings and hands off to advanced settings', async ({ page }) => {
  const setup = await openGuidedSetup(page)
  await setup.getByRole('button', { name: 'Advanced settings' }).click()
  await expect(setup).toHaveCount(0)
  await expect(page.getByTestId('settings-add-model')).toBeVisible()
})

test('guided setup connects a local server and saves it as the design model', async ({ page }) => {
  await serveCompatibleModel(page)
  const setup = await openGuidedSetup(page)
  const next = setup.getByRole('button', { name: 'Continue' })
  await next.click()
  await setup.getByRole('checkbox', { name: 'Local model or company server' }).click()
  await next.click()
  await next.click()

  await expect(next).toBeDisabled()
  await setup.getByRole('textbox', { name: 'Base URL' }).fill(SERVER_URL)
  await setup.getByRole('textbox', { name: 'Model ID' }).fill('qwen3-coder:30b')
  // The runtime needs a stored key even for servers that ignore it.
  await setup.getByLabel('API Key').fill('local-server-key')
  await setup.getByRole('button', { name: 'Test connection' }).click()
  await expect(next).toBeEnabled()
  await next.click()

  await setup.getByRole('button', { name: 'Finish setup' }).click()
  await expect(setup.getByRole('heading', { name: 'AI is ready' })).toBeVisible()
  await setup.getByRole('button', { name: 'Done' }).click()

  const models = page.getByTestId('settings-model-list')
  const model = models.locator('[data-model-id]', { hasText: 'qwen3-coder:30b' })
  await expect(model).toBeVisible()
  // The saved key shows without reopening Settings.
  await expect(model.getByText('Connected', { exact: true })).toBeVisible()
  await expect(models.getByText('Design model', { exact: true })).toHaveCount(0)
})

/** Stands in for OpenRouter: sign-in redirects back with a code, which exchanges for a key. */
async function serveOpenRouter(context: BrowserContext) {
  const exchanges: unknown[] = []
  await context.route('https://openrouter.ai/auth?**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>
        const params = new URLSearchParams(location.search)
        const callback = new URL(params.get('callback_url'))
        callback.searchParams.set('code', 'e2e-code')
        callback.searchParams.set('state', params.get('state'))
        location.replace(callback.href)
      </script>`
    })
  })
  await context.route('https://openrouter.ai/api/v1/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    if (request.url().endsWith('/auth/keys')) {
      exchanges.push(request.postDataJSON())
      await route.fulfill({ headers: CORS_HEADERS, json: { key: 'sk-or-e2e-key' } })
      return
    }
    await route.fulfill({
      headers: CORS_HEADERS,
      json: {
        id: 'gen-ai-setup',
        object: 'chat.completion',
        created: 0,
        model: 'anthropic/claude-sonnet-5',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }
    })
  })
  return exchanges
}

test('guided setup signs in with OpenRouter without pasting a key', async ({ page, context }) => {
  const exchanges = await serveOpenRouter(context)
  const setup = await openGuidedSetup(page)
  const next = setup.getByRole('button', { name: 'Continue' })
  await next.click()
  await next.click()
  await setup.getByRole('radio', { name: 'Recommend a pay-as-you-go model when needed' }).click()
  await next.click()

  await expect(next).toBeDisabled()
  const popup = page.waitForEvent('popup')
  await setup.getByRole('button', { name: 'Sign in with OpenRouter' }).click()
  await (await popup).waitForEvent('close')
  await expect(next).toBeEnabled()
  expect(exchanges).toEqual([
    { code: 'e2e-code', code_verifier: expect.any(String), code_challenge_method: 'S256' }
  ])

  await next.click()
  await setup.getByRole('button', { name: 'Finish setup' }).click()
  await expect(setup.getByRole('heading', { name: 'AI is ready' })).toBeVisible()
  await setup.getByRole('button', { name: 'Done' }).click()

  const model = page
    .getByTestId('settings-model-list')
    .locator('[data-model-id]', { hasText: 'Claude Sonnet 5' })
  await expect(model.getByText('Connected', { exact: true })).toBeVisible()
})
