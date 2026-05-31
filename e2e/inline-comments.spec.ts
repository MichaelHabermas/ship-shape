import { test, expect, type Page } from './fixtures/isolated-env'

test.describe('Inline Comments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  /**
   * Helper: create a document, type text, and return the document page
   */
  async function createDocumentWithText(page: Page, text: string) {
    await page.goto('/docs')
    const newButton = page.getByRole('button', { name: 'New Document', exact: true })
    await expect(newButton).toBeVisible({ timeout: 5000 })
    await newButton.click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Type text into editor
    const editor = page.locator('.ProseMirror')
    await editor.click()
    await page.keyboard.type(text, { delay: 5 })
    // Wait for content to sync
    await page.waitForTimeout(500)
  }

  /**
   * Helper: select a specific substring within the editor paragraph
   */
  async function selectText(page: Page, target: string) {
    await page.evaluate((t: string) => {
      const p = document.querySelector('[data-testid="tiptap-editor"] .ProseMirror p')
      if (!p) return
      const text = p.textContent || ''
      const idx = text.indexOf(t)
      if (idx === -1) return
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let node: Text | null
      let offset = 0
      while ((node = walker.nextNode() as Text | null)) {
        const len = node.textContent?.length || 0
        if (offset + len > idx) {
          const range = document.createRange()
          range.setStart(node, idx - offset)
          range.setEnd(node, idx - offset + t.length)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(range)
          break
        }
        offset += len
      }
    }, target)
    await page.waitForTimeout(400)
  }

  test('bubble menu shows Comment button on text selection', async ({ page }) => {
    await createDocumentWithText(page, 'Select this text to see the comment button appear.')

    await selectText(page, 'this text')

    // BubbleMenu should appear with Comment button
    const commentBtn = page.getByRole('button', { name: 'Comment' })
    await expect(commentBtn).toBeVisible({ timeout: 3000 })
  })

  test('can create an inline comment via bubble menu', async ({ page }) => {
    await createDocumentWithText(page, 'This paragraph has text that will receive an inline comment.')

    await selectText(page, 'inline comment')

    // Click Comment in bubble menu
    await page.getByRole('button', { name: 'Comment' }).click()

    // Comment input should appear
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await expect(commentInput).toBeVisible({ timeout: 3000 })

    // Type and submit
    await commentInput.fill('This is a test comment')
    await commentInput.press('Enter')

    // Wait for API response and decoration re-render
    await page.waitForTimeout(1500)

    // The inline comment card should appear with the comment text
    await expect(page.getByText('This is a test comment')).toBeVisible({ timeout: 5000 })

    // The highlighted text should have the comment-highlight class
    const highlight = page.locator('.comment-highlight')
    await expect(highlight).toBeVisible()
  })

  test('can create a comment via Cmd+Shift+M keyboard shortcut', async ({ page }) => {
    await createDocumentWithText(page, 'Testing keyboard shortcut for adding comments quickly.')

    await selectText(page, 'keyboard shortcut')

    // Press Cmd+Shift+M
    await page.keyboard.press('Meta+Shift+m')

    // Comment input should appear
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await expect(commentInput).toBeVisible({ timeout: 3000 })

    // Submit comment
    await commentInput.fill('Created via keyboard shortcut')
    await commentInput.press('Enter')

    await page.waitForTimeout(1500)

    await expect(page.getByText('Created via keyboard shortcut')).toBeVisible({ timeout: 5000 })
  })

  test('canceling a comment removes the highlight', async ({ page }) => {
    await createDocumentWithText(page, 'This text will have a comment that gets canceled.')

    await selectText(page, 'comment that gets canceled')

    await page.getByRole('button', { name: 'Comment' }).click()

    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await expect(commentInput).toBeVisible({ timeout: 3000 })
    // Ensure pending input has focus so Escape reliably reaches cancel handlers under load.
    await commentInput.focus()

    // Press Escape to cancel
    await page.keyboard.press('Escape')

    // Highlight should be removed (auto-retries until timeout)
    await expect(page.locator('.comment-highlight')).not.toBeVisible({ timeout: 10000 })
  })

  test('inline comment card shows quoted text, author, and timestamp', async ({ page }) => {
    await createDocumentWithText(page, 'The quoted text should appear in the comment card.')

    await selectText(page, 'quoted text')

    await page.getByRole('button', { name: 'Comment' }).click()
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await commentInput.fill('Checking the card layout')
    await commentInput.press('Enter')

    await page.waitForTimeout(1500)

    // Verify card shows quoted text
    await expect(page.getByText('"quoted text"')).toBeVisible({ timeout: 5000 })

    // Verify author name
    await expect(page.locator('.comment-author').first()).toContainText('Dev User')

    // Verify timestamp
    await expect(page.locator('.comment-time').first()).toBeVisible()

    // Verify reply input
    const replyInput = page.getByRole('textbox', { name: 'Reply...' })
    await expect(replyInput).toBeVisible()
  })

  test('can reply to an existing comment', async ({ page }) => {
    await createDocumentWithText(page, 'This comment will receive a reply from another user.')

    await selectText(page, 'receive a reply')

    // Create initial comment
    await page.getByRole('button', { name: 'Comment' }).click()
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await commentInput.fill('Original comment')
    await commentInput.press('Enter')
    await page.waitForTimeout(1500)

    // Click the reply input and type a reply
    const replyInput = page.getByRole('textbox', { name: 'Reply...' })
    await replyInput.click()
    await page.keyboard.type('This is a reply to the original', { delay: 5 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)

    // Reload to verify persistence
    await page.reload()
    await page.waitForTimeout(3000)

    // Both comments should be visible after reload
    await expect(page.getByText('Original comment')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('This is a reply to the original')).toBeVisible({ timeout: 5000 })
  })

  test('resolving a comment collapses thread and removes highlight', async ({ page }) => {
    await createDocumentWithText(page, 'This highlighted text will be resolved and collapsed.')

    await selectText(page, 'resolved and collapsed')

    // Create comment
    await page.getByRole('button', { name: 'Comment' }).click()
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await commentInput.fill('This will be resolved')
    await commentInput.press('Enter')
    await page.waitForTimeout(1500)

    // Verify comment card is visible
    await expect(page.getByText('This will be resolved')).toBeVisible({ timeout: 5000 })

    // Click resolve button
    await page.getByRole('button', { name: '✓' }).click()
    await page.waitForTimeout(1500)

    // Thread should collapse to indicator
    await expect(page.getByText('Resolved by Dev User')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Show thread')).toBeVisible()

    // Original comment text should NOT be visible (collapsed)
    await expect(page.getByText('This will be resolved')).not.toBeVisible()

    // Highlight should be removed (transparent via CSS :has())
    const highlight = page.locator('.comment-highlight')
    if (await highlight.count() > 0) {
      const bgColor = await highlight.evaluate((el: HTMLElement) =>
        window.getComputedStyle(el).backgroundColor
      )
      expect(bgColor).toBe('rgba(0, 0, 0, 0)')
    }
  })

  test('un-resolving restores thread and highlight', async ({ page }) => {
    await createDocumentWithText(page, 'Un-resolving should restore the full comment thread.')

    await selectText(page, 'restore the full')

    // Create and resolve
    await page.getByRole('button', { name: 'Comment' }).click()
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await commentInput.fill('Will be resolved then un-resolved')
    await commentInput.press('Enter')
    await page.waitForTimeout(1500)

    await page.getByRole('button', { name: '✓' }).click()
    await page.waitForTimeout(1500)

    // Verify collapsed
    await expect(page.getByText('Show thread')).toBeVisible({ timeout: 5000 })

    // Click "Show thread" to un-resolve
    await page.getByText('Show thread').click()
    await page.waitForTimeout(1500)

    // Thread should be expanded again
    await expect(page.getByText('Will be resolved then un-resolved')).toBeVisible({ timeout: 5000 })

    // Highlight should be restored (visible amber color)
    const highlight = page.locator('.comment-highlight')
    await expect(highlight).toBeVisible()
    const bgColor = await highlight.evaluate((el: HTMLElement) =>
      window.getComputedStyle(el).backgroundColor
    )
    expect(bgColor).toContain('245')  // rgba(245, 158, 11, 0.2)
  })

  test('comments persist across page reload', async ({ page }) => {
    await createDocumentWithText(page, 'Comments should survive a full page reload for persistence.')

    await selectText(page, 'full page reload')

    // Create comment
    await page.getByRole('button', { name: 'Comment' }).click()
    const commentInput = page.getByRole('textbox', { name: 'Write a comment...' })
    await commentInput.fill('Persistence check')
    await commentInput.press('Enter')
    await page.waitForTimeout(1500)

    await expect(page.getByText('Persistence check')).toBeVisible({ timeout: 5000 })

    // Reload
    await page.reload()
    await page.waitForTimeout(3000)

    // Comment should still be visible after reload
    await expect(page.getByText('Persistence check')).toBeVisible({ timeout: 10000 })
  })
})
