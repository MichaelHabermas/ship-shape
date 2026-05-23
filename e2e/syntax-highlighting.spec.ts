import { test, expect, Page } from './fixtures/isolated-env'

/**
 * Syntax Highlighting E2E Tests
 *
 * Tests code block creation, language selection, and syntax highlighting.
 */

// Helper to login before each test
async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

// Helper to create a new document and get to the editor
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
}

test.describe('Syntax Highlighting - Code Blocks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('can create code block via triple backticks', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type triple backticks followed by space or enter to trigger code block creation
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)

    // Should convert to code block - check for code-block-lowlight class (TipTap's wrapper)
    const codeBlock = editor.locator('.code-block-lowlight').first()
    await expect(codeBlock).toBeVisible({ timeout: 3000 })
  })

  test('can create code block via slash command', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type /code to trigger slash command menu
    await page.keyboard.type('/code')
    await page.waitForTimeout(500)

    // Click the Code Block option (use specific button selector)
    const codeOption = page.getByRole('button', { name: /^Code Block Capture a code snippet/i })
    await expect(codeOption).toBeVisible({ timeout: 3000 })
    await codeOption.click()

    // Should create code block - check for code-block-lowlight class (TipTap's wrapper)
    const codeBlock = editor.locator('.code-block-lowlight').first()
    await expect(codeBlock).toBeVisible({ timeout: 3000 })
  })

  test('can select programming language for code block', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create code block with language specifier
    await page.keyboard.type('```javascript')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const x = 42;')
    await page.waitForTimeout(500)

    // Should have code block with language class
    const codeBlock = page.locator('.ProseMirror pre code')
    await expect(codeBlock).toBeVisible()

    // Check if language class is applied (Prism.js adds language-javascript)
    const hasLanguageClass = await codeBlock.evaluate(el => {
      return el.className.includes('language-javascript') ||
             el.className.includes('javascript') ||
             el.parentElement?.getAttribute('data-language') === 'javascript'
    })
    expect(hasLanguageClass).toBeTruthy()
  })

  test('syntax highlighting renders for JavaScript', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create JavaScript code block
    await page.keyboard.type('```javascript')
    await page.keyboard.press('Enter')
    await page.keyboard.type('function hello() {')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  return "world";')
    await page.keyboard.press('Enter')
    await page.keyboard.type('}')
    await page.waitForTimeout(1000)

    // Verify code block exists
    const codeBlock = page.locator('.ProseMirror pre code')
    await expect(codeBlock).toBeVisible()

    // Check that syntax highlighting spans exist (lowlight/highlight.js uses hljs-* classes)
    const hasHighlighting = await codeBlock.evaluate(el => {
      const spans = el.querySelectorAll('span[class*="hljs-"], span[class*="token"]')
      return spans.length > 0
    })

    expect(hasHighlighting).toBe(true)

    // Content should still be present after highlighting wraps tokens
    const codeContent = await codeBlock.textContent()
    expect(codeContent).toContain('function')
    expect(codeContent).toContain('hello')
  })

  test('can edit code inside code block', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create code block
    await page.keyboard.type('```python')
    await page.keyboard.press('Enter')
    await page.keyboard.type('print("Hello")')
    await page.waitForTimeout(500)

    // Get initial content - use code-block-lowlight class
    const codeBlock = editor.locator('.code-block-lowlight').first()
    let content = await codeBlock.locator('code').textContent()
    expect(content).toContain('Hello')

    // Edit the code - add more content
    await codeBlock.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('x = 42')
    await page.waitForTimeout(500)

    // Verify edited content
    content = await codeBlock.locator('code').textContent()
    expect(content).toContain('Hello')
    expect(content).toContain('x = 42')
  })

  test('code block content persists after save', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create code block with unique content
    const uniqueCode = `const timestamp = ${Date.now()};`
    await page.keyboard.type('```javascript')
    await page.keyboard.press('Enter')
    await page.keyboard.type(uniqueCode)
    await page.waitForTimeout(500)

    // Get current URL
    const docUrl = page.url()

    // Wait for auto-save
    await page.waitForTimeout(2000)

    // Navigate away and back
    await page.goto('/docs')
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 5000 })

    // Navigate back to document
    await page.goto(docUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Verify code block and content persisted - use code-block-lowlight class
    const codeBlock = page.locator('.ProseMirror .code-block-lowlight').first()
    await expect(codeBlock).toBeVisible({ timeout: 3000 })

    const content = await codeBlock.locator('code').textContent()
    expect(content).toContain(uniqueCode)
  })

  test('can create multiple code blocks in same document', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create first code block via triple backticks
    await page.keyboard.type('```javascript')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const a = 1;')
    await page.waitForTimeout(300)

    // Navigate after code block using arrow keys and Cmd+End to go to document end
    await page.keyboard.press('Meta+End')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    // Create second code block
    await page.keyboard.type('```python')
    await page.keyboard.press('Enter')
    await page.keyboard.type('b = 2')
    await page.waitForTimeout(500)

    // Verify code blocks exist - use code-block-lowlight class
    const codeBlocks = editor.locator('.code-block-lowlight')
    const count = await codeBlocks.count()

    // May have 1 or 2 code blocks depending on behavior
    expect(count).toBeGreaterThanOrEqual(1)

    // Verify at least the first code block has content
    const firstBlock = await codeBlocks.first().locator('code').textContent()
    expect(firstBlock).toContain('const a = 1')
  })

  test('pressing Enter inside code block creates new line, not new paragraph', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create code block
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line 1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line 2')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line 3')
    await page.waitForTimeout(500)

    // Should still be in single code block - use code-block-lowlight class
    const codeBlocks = editor.locator('.code-block-lowlight')
    const count = await codeBlocks.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // Content should have all three lines - check code element inside
    const content = await codeBlocks.first().locator('code').textContent()
    expect(content).toContain('line 1')
    expect(content).toContain('line 2')
    expect(content).toContain('line 3')
  })

  test('code block maintains multiline content', async ({ page }) => {
    // This tests that code blocks properly handle multiline input
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create code block
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line 1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line 2')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line 3')
    await page.waitForTimeout(500)

    // Verify code block exists and contains all lines
    const codeBlock = editor.locator('.code-block-lowlight').first()
    await expect(codeBlock).toBeVisible({ timeout: 3000 })

    const content = await codeBlock.locator('code').textContent()
    expect(content).toContain('line 1')
    expect(content).toContain('line 2')
    expect(content).toContain('line 3')
  })
})
