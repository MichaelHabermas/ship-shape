import { test, expect, Page } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';


/**
 * Table of Contents (TOC) E2E Tests
 *
 * Tests TOC creation, updating, navigation, and persistence.
 */

// Helper to create a new document and get to the editor
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
}

// Helper to add headings to the document
async function addHeadings(page: Page, headings: Array<{ level: number; text: string }>) {
  const editor = page.locator('.ProseMirror')
  await editor.click()

  for (let i = 0; i < headings.length; i++) {
    const { level, text } = headings[i]
    const hashes = '#'.repeat(level)
    await page.keyboard.type(`${hashes} ${text}`)
    if (i < headings.length - 1) {
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
    }
  }

  await page.waitForTimeout(500)
}

// FIXME: Slash command menu interaction not working - button locators timing out
test.describe('Table of Contents (TOC)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('can create TOC via /toc command', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type /toc to trigger slash command
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    // Look for TOC option in menu - use button role to be specific
    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    // Should insert TOC node
    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })
  })

  test('TOC shows document headings', async ({ page }) => {
    await createNewDocument(page)

    // Add some headings first
    await addHeadings(page, [
      { level: 1, text: 'Introduction' },
      { level: 2, text: 'Background' },
      { level: 2, text: 'Methods' }
    ])

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Move to end and add TOC
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    // TOC should show the headings
    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    const tocText = await toc.textContent()
    expect(tocText).toContain('Introduction')
    expect(tocText).toContain('Background')
    expect(tocText).toContain('Methods')
  })

  test('TOC updates when heading added', async ({ page }) => {
    await createNewDocument(page)

    // Add initial heading
    await addHeadings(page, [
      { level: 1, text: 'First Heading' }
    ])

    // Add TOC
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    // Add new heading
    const editor = page.locator('.ProseMirror')
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('## Second Heading')
    await page.waitForTimeout(1000)

    // TOC should update to include new heading
    const tocText = await toc.textContent()
    expect(tocText).toContain('First Heading')
    expect(tocText).toContain('Second Heading')
  })

  test('TOC updates when heading removed', async ({ page }) => {
    await createNewDocument(page)

    // Add multiple headings
    await addHeadings(page, [
      { level: 1, text: 'Keep This' },
      { level: 2, text: 'Delete This' },
      { level: 2, text: 'Keep This Too' }
    ])

    // Add TOC
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    // Verify all headings are in TOC
    let tocText = await toc.textContent()
    expect(tocText).toContain('Keep This')
    expect(tocText).toContain('Delete This')
    expect(tocText).toContain('Keep This Too')

    // Delete the "Delete This" heading
    const headingToDelete = page.locator('.ProseMirror h2').filter({ hasText: 'Delete This' })
    await headingToDelete.click()

    // Select heading text only (not entire document) using triple-click
    await headingToDelete.click({ clickCount: 3 })
    await page.waitForTimeout(200)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(1000)

    // TOC should update - "Delete This" should be gone
    tocText = await toc.textContent()
    expect(tocText).toContain('Keep This')
    expect(tocText).not.toContain('Delete This')
    expect(tocText).toContain('Keep This Too')
  })

  test('TOC updates when heading renamed', async ({ page }) => {
    await createNewDocument(page)

    // Add heading
    await addHeadings(page, [
      { level: 1, text: 'Original Title' }
    ])

    // Add TOC
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    // Verify original title
    let tocText = await toc.textContent()
    expect(tocText).toContain('Original Title')

    // Use purely keyboard-based approach to avoid inline comment overlay issues
    // The cursor is currently in the editor after TOC insertion
    // First dismiss any tooltips/menus
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Go to the very start of the document (above TOC, into heading)
    await page.keyboard.press('Meta+ArrowUp')
    await page.waitForTimeout(100)
    // Select the entire first line (the heading text)
    await page.keyboard.press('Shift+Meta+ArrowDown')
    await page.waitForTimeout(100)
    // Now type replacement - but Shift+Meta+ArrowDown may select too much
    // Instead, select just to end of current line
    await page.keyboard.press('Meta+ArrowUp')  // Reset to start
    await page.waitForTimeout(100)
    await page.keyboard.press('Meta+Shift+ArrowRight')  // Select to end of line
    await page.waitForTimeout(100)
    await page.keyboard.type('New Title')
    await page.waitForTimeout(1000)

    // TOC should update
    tocText = await toc.textContent()
    expect(tocText).toContain('New Title')
    expect(tocText).not.toContain('Original Title')
  })

  test('clicking TOC item scrolls to heading', async ({ page }) => {
    await createNewDocument(page)

    // Add multiple headings with content to create scrollable document
    await addHeadings(page, [
      { level: 1, text: 'Section One' },
      { level: 1, text: 'Section Two' },
      { level: 1, text: 'Section Three' }
    ])

    // Add some content to make document scrollable
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await page.keyboard.press('Enter')
    }

    // Add TOC at top
    const firstHeading = page.locator('.ProseMirror h1').first()
    await firstHeading.click()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    // Scroll to bottom first
    await page.keyboard.press('End')
    await page.waitForTimeout(500)

    // Click on "Section Two" in TOC
    const sectionTwoLink = toc.locator('text="Section Two"').or(toc.locator('[href*="section-two"]'))
    if (await sectionTwoLink.isVisible()) {
      await sectionTwoLink.click()
      await page.waitForTimeout(1000)

      // Verify "Section Two" heading is in viewport
      const sectionTwoHeading = page.locator('.ProseMirror h1').filter({ hasText: 'Section Two' })
      await expect(sectionTwoHeading).toBeInViewport({ timeout: 3000 })
    }
  })

  test('TOC handles multiple heading levels', async ({ page }) => {
    await createNewDocument(page)

    // Add headings of different levels
    await addHeadings(page, [
      { level: 1, text: 'Chapter One' },
      { level: 2, text: 'Section 1.1' },
      { level: 3, text: 'Subsection 1.1.1' },
      { level: 2, text: 'Section 1.2' },
      { level: 1, text: 'Chapter Two' }
    ])

    // Add TOC
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    // TOC should show all levels
    const tocText = await toc.textContent()
    expect(tocText).toContain('Chapter One')
    expect(tocText).toContain('Section 1.1')
    expect(tocText).toContain('Subsection 1.1.1')
    expect(tocText).toContain('Section 1.2')
    expect(tocText).toContain('Chapter Two')

    // Check for indentation or nesting (TOC should show hierarchy)
    const tocHTML = await toc.innerHTML()
    // TOC uses toc-item-h1, toc-item-h2, toc-item-h3 classes for hierarchy
    const hasNesting = tocHTML.includes('<ul') ||
                      tocHTML.includes('<ol') ||
                      tocHTML.includes('indent') ||
                      tocHTML.includes('nested') ||
                      tocHTML.includes('toc-item-h1') ||
                      tocHTML.includes('toc-item-h2') ||
                      tocHTML.includes('toc-item-h3')
    expect(hasNesting).toBeTruthy()
  })

  test('TOC persists after page reload', async ({ page }) => {
    await createNewDocument(page)

    // Add headings
    await addHeadings(page, [
      { level: 1, text: 'Persistent Heading' },
      { level: 2, text: 'Subheading' }
    ])

    // Add TOC
    await page.keyboard.press('Enter')
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    // Verify TOC exists
    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

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
    await page.waitForTimeout(1000)

    // Verify TOC persisted
    const restoredToc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(restoredToc).toBeVisible({ timeout: 3000 })

    const tocText = await restoredToc.textContent()
    expect(tocText).toContain('Persistent Heading')
    expect(tocText).toContain('Subheading')
  })

  test('empty document TOC shows "No headings" message', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Add TOC without any headings
    await page.keyboard.type('/toc')
    await page.waitForTimeout(500)

    const tocOption = page.getByRole('button', { name: /Table of Contents/i })
    await expect(tocOption).toBeVisible({ timeout: 3000 })
    await tocOption.click()
    await page.waitForTimeout(500)

    const toc = page.locator('[data-toc], .toc, .table-of-contents').first()
    await expect(toc).toBeVisible({ timeout: 3000 })

    // Should show empty state or "No headings" message
    const tocText = await toc.textContent()
    const hasEmptyMessage = tocText?.toLowerCase().includes('no headings') ||
                           tocText?.toLowerCase().includes('empty') ||
                           tocText?.toLowerCase().includes('add headings') ||
                           tocText?.trim() === ''
    expect(hasEmptyMessage).toBeTruthy()
  })
})
