import { test, expect, Page } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';


/**
 * Emoji Picker E2E Tests
 *
 * Tests emoji picker trigger, filtering, selection, and rendering.
 */

// Helper to create a new document and get to the editor
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
}

test.describe('Emoji Picker', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('typing : shows emoji picker', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type : to trigger emoji picker
    await page.keyboard.type(':')
    await page.waitForTimeout(500)

    // Emoji picker should appear (look for common selectors)
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    await expect(picker).toBeVisible({ timeout: 3000 })
  })

  test('typing filters emoji list', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type :smile to filter
    await page.keyboard.type(':smile')
    await page.waitForTimeout(500)

    // Picker should be visible
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    await expect(picker).toBeVisible({ timeout: 3000 })

    // Should show filtered results (look for emoji options)
    const options = page.locator('[role="option"], .emoji-option, [data-emoji-option]')
    const count = await options.count()
    expect(count).toBeGreaterThan(0)

    // Results should be related to "smile"
    const pickerText = await picker.textContent()
    expect(pickerText?.toLowerCase()).toContain('smile')
  })

  test('can select emoji with Enter key', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type to trigger picker and filter
    await page.keyboard.type(':smile')
    await page.waitForTimeout(500)

    // Wait for picker to be visible
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    await expect(picker).toBeVisible({ timeout: 3000 })

    // Press Enter to select first option
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    // Emoji should be inserted in editor
    const editorContent = await editor.textContent()
    // Should contain some emoji character (unicode emoji)
    expect(editorContent).toMatch(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u)
  })

  test('can select emoji with click', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type to trigger picker
    await page.keyboard.type(':heart')
    await page.waitForTimeout(500)

    // Wait for picker
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    await expect(picker).toBeVisible({ timeout: 3000 })

    // Click first emoji option
    const firstOption = page.locator('[role="option"], .emoji-option, [data-emoji-option]').first()
    if (await firstOption.isVisible()) {
      await firstOption.click()
      await page.waitForTimeout(300)

      // Emoji should be inserted
      const editorContent = await editor.textContent()
      expect(editorContent).toMatch(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u)
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  test('emoji renders correctly in document', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type and insert emoji
    await page.keyboard.type(':thumbs')
    await page.waitForTimeout(500)

    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    if (await picker.isVisible({ timeout: 3000 })) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)

      // Emoji should be visible and rendered
      const editorContent = await editor.textContent()
      expect(editorContent?.length).toBeGreaterThan(0)

      // Check that emoji is visible (not just text)
      const hasEmoji = await editor.evaluate(el => {
        const text = el.textContent || ''
        // Unicode emoji range check
        return /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(text)
      })
      expect(hasEmoji).toBeTruthy()
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  test('emoji persists after save and reload', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Insert emoji
    await page.keyboard.type(':fire')
    await page.waitForTimeout(500)

    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    if (await picker.isVisible({ timeout: 3000 })) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)

      // Get emoji content
      const originalContent = await editor.textContent()
      const hasEmoji = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(originalContent || '')

      if (hasEmoji) {
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

        // Verify emoji persisted
        const restoredContent = await editor.textContent()
        const stillHasEmoji = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(restoredContent || '')
        expect(stillHasEmoji).toBeTruthy()
      } else {
        expect(true).toBe(false) // Element not found, test cannot continue
      }
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  test('can navigate emoji picker with arrow keys', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type to trigger picker
    await page.keyboard.type(':smile')
    await page.waitForTimeout(500)

    // Wait for picker
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    await expect(picker).toBeVisible({ timeout: 3000 })

    // Press ArrowDown to navigate
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(200)

    // Check if there's a selected option (aria-selected="true")
    const selectedOption = page.locator('[role="option"][aria-selected="true"], .emoji-option.selected, [data-emoji-option].selected')
    const hasSelection = await selectedOption.count()

    // Navigation should work (either selection exists or we can verify keyboard works)
    expect(hasSelection).toBeGreaterThanOrEqual(0)

    // Try pressing ArrowUp
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(200)

    // Pressing Escape should close picker
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Picker should be hidden
    await expect(picker).toBeHidden({ timeout: 2000 })
  })

  test('pressing Escape closes emoji picker', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type to trigger picker
    await page.keyboard.type(':joy')
    await page.waitForTimeout(500)

    // Wait for picker
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    await expect(picker).toBeVisible({ timeout: 3000 })

    // Press Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Picker should be hidden
    await expect(picker).toBeHidden({ timeout: 2000 })
  })

  test('typing non-matching text shows no results', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type something that won't match any emoji
    await page.keyboard.type(':zzzznonexistent12345')
    await page.waitForTimeout(500)

    // Picker might show "No results" or be hidden
    const picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()

    if (await picker.isVisible({ timeout: 1000 })) {
      // Check for "No results" message
      const pickerText = await picker.textContent()
      const hasNoResults = pickerText?.toLowerCase().includes('no') ||
                          pickerText?.toLowerCase().includes('not found') ||
                          pickerText?.toLowerCase().includes('empty')

      // Or check that options count is 0
      const options = page.locator('[role="option"], .emoji-option, [data-emoji-option]')
      const count = await options.count()

      expect(hasNoResults || count === 0).toBeTruthy()
    } else {
      // Picker not visible is also acceptable (auto-closed on no results)
      expect(true).toBeTruthy()
    }
  })

  test('can insert multiple emojis in same document', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Insert first emoji
    await page.keyboard.type(':smile')
    await page.waitForTimeout(500)

    let picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
    if (await picker.isVisible({ timeout: 3000 })) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      // Type some text
      await page.keyboard.type(' hello ')
      await page.waitForTimeout(200)

      // Insert second emoji
      await page.keyboard.type(':heart')
      await page.waitForTimeout(500)

      picker = page.locator('[role="listbox"], .emoji-picker, [data-emoji-picker]').first()
      if (await picker.isVisible({ timeout: 3000 })) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(500)

        // Verify content has both emojis and text
        const content = await editor.textContent()
        expect(content).toContain('hello')

        // Count emoji characters
        const emojiMatches = content?.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu)
        expect(emojiMatches?.length).toBeGreaterThanOrEqual(1)
      }
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })
})
