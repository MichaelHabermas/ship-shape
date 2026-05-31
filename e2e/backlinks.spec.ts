import { test, expect } from './fixtures/isolated-env'
import { triggerMentionPopup } from './fixtures/test-helpers'
import { login, createWikiDoc, setDocumentTitle } from './fixtures/app'

/**
 * Backlinks E2E Tests
 *
 * Tests backlink panel display, creation, removal, and navigation.
 *
 * Test helper note (2026-05-23): PR #4 (18c25dd) moved login/doc creation to
 * `e2e/fixtures/app.ts` but left four tests calling removed local
 * `createNewDocument`. Those tests now use `createWikiDoc` (same behavior:
 * creates a wiki doc and returns its URL) — not a product behavior change.
 */

test.describe('Backlinks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('backlinks panel shows in sidebar', async ({ page }) => {
    await createWikiDoc(page)

    // Look for backlinks panel in properties sidebar (right side)
    // Common selectors: "Backlinks", "Referenced by", or a data attribute
    const backlinksPanel = page.locator('text="Backlinks"').or(
      page.locator('text="Referenced by"')
    ).or(
      page.locator('[data-backlinks-panel]')
    )

    // Backlinks panel should be visible in sidebar
    await expect(backlinksPanel.first()).toBeVisible({ timeout: 5000 })
  })

  test('creating mention adds backlink', async ({ page }) => {
    // Create Document A (will be mentioned)
    const docAUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Document A')

    // Create Document B (will mention Document A)
    await createWikiDoc(page)
    await setDocumentTitle(page, 'Document B')

    const editor = page.locator('.ProseMirror')
    await triggerMentionPopup(page, editor)

    // Type search term to filter
    await page.keyboard.type('Document A')
    await page.waitForTimeout(500)

    // Select Document A from list
    const docAOption = page.locator('[role="option"]').filter({ hasText: 'Document A' })
    await expect(docAOption).toBeVisible({ timeout: 5000 })
    await docAOption.click()
    await page.waitForTimeout(1000)

    // Navigate to Document A
    await page.goto(docAUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Reload to ensure backlinks are fetched fresh
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Document A should now show Document B in backlinks
    // Scope to properties sidebar to avoid matching sidebar doc list
    const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
    await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

    const backlinksPanel = propertiesSidebar.locator('text="Backlinks"').or(
      propertiesSidebar.locator('text="Referenced by"')
    ).or(
      propertiesSidebar.locator('[data-backlinks-panel]')
    ).first()

    await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

    // Look for Document B in backlinks (within properties sidebar)
    const hasDocB = await propertiesSidebar.locator('text="Document B"').isVisible({ timeout: 5000 })
    expect(hasDocB).toBeTruthy()
  })

  test('removing mention removes backlink', async ({ page }) => {
    // Create Document A (will be mentioned)
    const docAUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Doc to Mention')

    // Create Document B (will mention Document A, then remove it)
    await createWikiDoc(page)
    await setDocumentTitle(page, 'Doc with Mention')

    const editor = page.locator('.ProseMirror')
    await triggerMentionPopup(page, editor)

    await page.keyboard.type('Doc to Mention')
    await page.waitForTimeout(500)

    const docOption = page.locator('[role="option"]').filter({ hasText: 'Doc to Mention' })
    await expect(docOption).toBeVisible({ timeout: 5000 })
    await docOption.click()
    await page.waitForTimeout(1000)

    // Delete the mention by selecting all content and deleting it
    // NOTE: Can't click on .mention directly because MentionExtension's click handler
    // calls onNavigate() which navigates away from the page.
    // Instead, use keyboard shortcuts to select all and delete.
    const mention = editor.locator('.mention')
    await expect(mention).toBeVisible({ timeout: 3000 })

    // Focus the editor and select all content
    await editor.click()
    await page.keyboard.press('Meta+a') // Select all (Cmd+A on Mac)
    await page.keyboard.press('Backspace') // Delete selected content

    // Wait for editor update to propagate (debounce is 500ms)
    await page.waitForTimeout(1000)

    // Verify mention is deleted before waiting for POST
    await expect(editor.locator('.mention')).not.toBeVisible({ timeout: 3000 })

    // Wait for the link sync POST request (debounced 500ms)
    await page.waitForResponse(
      resp => resp.url().includes('/links') && resp.request().method() === 'POST',
      { timeout: 5000 }
    ).catch((err) => {
      console.log('No /links POST detected after mention removal:', err.message)
    })

    // Extra wait for sync to propagate
    await page.waitForTimeout(1500)

    // Navigate to Document A and reload to ensure fresh backlinks data
    await page.goto(docAUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)

    // Reload to ensure backlinks are fetched fresh from server
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Document A should NOT show Document B in backlinks (or show empty state)
    // Look within the properties sidebar for backlinks
    const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
    await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

    // Should either show "No backlinks" or not have "Doc with Mention" in the backlinks section
    const hasNoBacklinks = await propertiesSidebar.locator('text="No backlinks"').isVisible({ timeout: 2000 })
    const hasDocWithMention = await propertiesSidebar.locator('text="Doc with Mention"').isVisible({ timeout: 2000 })

    // Either "No backlinks" is shown, OR the doc is not in the backlinks
    expect(hasNoBacklinks || !hasDocWithMention).toBeTruthy()
  })

  test('backlinks show correct document info', async ({ page }) => {
    // Create Document X
    const docXUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Target Document')

    // Create Document Y that mentions X
    await createWikiDoc(page)
    await setDocumentTitle(page, 'Referencing Document')

    const editor = page.locator('.ProseMirror')
    await triggerMentionPopup(page, editor)

    await page.keyboard.type('Target Document')
    await page.waitForTimeout(500)

    const docOption = page.locator('[role="option"]').filter({ hasText: 'Target Document' })
    await expect(docOption).toBeVisible({ timeout: 5000 })
    await docOption.click()
    await page.waitForTimeout(1000)

    // Navigate to Target Document
    await page.goto(docXUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Reload to ensure backlinks are fetched fresh
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Check backlinks panel shows correct info
    // Scope to properties sidebar to avoid matching sidebar doc list
    const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
    await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

    const backlinksPanel = propertiesSidebar.locator('text="Backlinks"').or(
      propertiesSidebar.locator('text="Referenced by"')
    ).or(
      propertiesSidebar.locator('[data-backlinks-panel]')
    ).first()

    await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

    // Should show "Referencing Document" with document icon or title (within properties sidebar)
    const backlink = propertiesSidebar.locator('text="Referencing Document"')
    await expect(backlink).toBeVisible({ timeout: 5000 })
  })

  test('clicking backlink navigates to source document', async ({ page }) => {
    // Listen for console messages
    page.on('console', msg => {
      if (msg.text().includes('LinkSync')) {
        console.log('[Browser]', msg.text())
      }
    })

    // Create Document M (will be mentioned)
    const docMUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Mentioned Doc')

    // Create Document N (will mention Document M)
    const docNUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Source Doc')

    const editor = page.locator('.ProseMirror')
    await triggerMentionPopup(page, editor)

    await page.keyboard.type('Mentioned Doc')
    await page.waitForTimeout(500)

    const docOption = page.locator('[role="option"]').filter({ hasText: 'Mentioned Doc' })
    await expect(docOption).toBeVisible({ timeout: 5000 })
    await docOption.click()

    // Wait for the link sync POST request (debounced 500ms)
    await page.waitForResponse(
      resp => resp.url().includes('/links') && resp.request().method() === 'POST',
      { timeout: 5000 }
    ).catch(() => console.log('No /links POST detected'))

    // Wait for any pending syncs
    await page.waitForTimeout(1000)

    // Navigate to Mentioned Doc and reload to ensure fresh backlinks data
    await page.goto(docMUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Reload to ensure backlinks are fetched fresh from server
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Find backlink to Source Doc in the properties sidebar and click it
    const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
    await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

    // Look for "Source Doc" link within the properties sidebar
    const sourceLinkInBacklinks = propertiesSidebar.locator('text="Source Doc"')
    await expect(sourceLinkInBacklinks.first()).toBeVisible({ timeout: 5000 })
    await sourceLinkInBacklinks.first().click()
    await page.waitForTimeout(1000)

    // Should navigate to Source Doc (Document N)
    const docSlug = docNUrl.split('/').pop();
    expect(docSlug).toBeTruthy();
    if (!docSlug) {
      throw new Error('expected document slug in source URL');
    }
    expect(page.url()).toContain(docSlug);

    // Verify we're on Source Doc page
    const titleInput = page.getByPlaceholder('Untitled')
    const title = await titleInput.inputValue()
    expect(title).toBe('Source Doc')
  })

  test('backlinks update in real-time', async ({ page, browser }) => {
    // Create Document P (will be mentioned)
    const docPUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Real-time Doc')

    // Open second browser context for Document Q
    const page2 = await browser.newPage()
    await page2.goto('/login')
    await page2.locator('#email').fill('dev@ship.local')
    await page2.locator('#password').fill('admin123')
    await page2.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page2).not.toHaveURL('/login', { timeout: 5000 })

    // Create Document Q in second tab
    await page2.goto('/docs')
    // Wait for page to stabilize and dismiss any modal that might be open
    await page2.waitForTimeout(500)
    await page2.keyboard.press('Escape')
    await page2.waitForTimeout(300)
    await page2.getByRole('button', { name: 'New Document', exact: true }).click()
    await expect(page2).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
    await expect(page2.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    const titleInput2 = page2.getByPlaceholder('Untitled')
    await titleInput2.fill('Live Update Doc')
    await page2.waitForResponse(
      resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
      { timeout: 5000 }
    )
    await page2.waitForTimeout(500)

    // In page2, mention Document P
    const editor2 = page2.locator('.ProseMirror')
    await triggerMentionPopup(page2, editor2)

    // Type search term to filter
    await page2.keyboard.type('Real-time Doc')
    await page2.waitForTimeout(500)

    // Select the document option
    const docOption = page2.locator('[role="option"]').filter({ hasText: 'Real-time Doc' })
    await expect(docOption).toBeVisible({ timeout: 5000 })
    await docOption.click()

    // Wait for sync to complete in page2
    await page2.waitForResponse(
      resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
      { timeout: 5000 }
    ).catch(() => {}) // Ignore if no response
    await page2.waitForTimeout(2000)

    // In page1 (Document P), check if backlinks updated
    await page.goto(docPUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Reload to ensure backlinks are fetched fresh from server
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Should see "Live Update Doc" in backlinks within properties sidebar
    const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
    await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

    // Look for backlinks heading
    const backlinksHeading = propertiesSidebar.locator('text="Backlinks"')
    await expect(backlinksHeading).toBeVisible({ timeout: 3000 })

    // Check for "Live Update Doc" within the properties sidebar
    const liveUpdateDocLink = propertiesSidebar.locator('text="Live Update Doc"')
    await expect(liveUpdateDocLink).toBeVisible({ timeout: 5000 })

    // Clean up
    await page2.close()
  })

  test('backlinks panel shows empty state when no backlinks', async ({ page }) => {
    await createWikiDoc(page)
    await setDocumentTitle(page, 'Lonely Document')

    // Wait a moment for any potential backlinks to load
    await page.waitForTimeout(1000)

    // Find backlinks panel
    const backlinksPanel = page.locator('text="Backlinks"').or(
      page.locator('text="Referenced by"')
    ).or(
      page.locator('[data-backlinks-panel]')
    ).first()

    await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

    // Should show empty state message
    const emptyMessage = page.getByText('No backlinks', { exact: false }).or(
      page.getByText('No documents reference this page', { exact: false })
    ).or(
      page.getByText('Not referenced', { exact: false })
    )

    // Either empty message is visible or no backlink items exist
    const hasEmptyMessage = await emptyMessage.isVisible({ timeout: 2000 })
    const backlinkItems = page.locator('[data-backlink-item], .backlink-item, .backlink')
    const itemCount = await backlinkItems.count()

    expect(hasEmptyMessage || itemCount === 0).toBeTruthy()
  })

  test('backlinks count updates correctly', async ({ page }) => {
    // Create Document Z (will be mentioned)
    const docZUrl = await createWikiDoc(page)
    await setDocumentTitle(page, 'Popular Doc')

    // Create two documents that mention Document Z
    for (let i = 1; i <= 2; i++) {
      await page.goto('/docs')
      await page.getByRole('button', { name: 'New Document', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
      await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

      const titleInput = page.getByPlaceholder('Untitled')
      await titleInput.fill(`Referrer ${i}`)
      await page.waitForResponse(
        resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
        { timeout: 5000 }
      )

      const editor = page.locator('.ProseMirror')

      // Blur title input first by pressing Tab, then focus editor
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)

      // Click editor to ensure focus
      await editor.click()
      await page.waitForTimeout(500)

      // Ensure editor has focus by checking it's the active element
      await page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror')
        if (editor instanceof HTMLElement) editor.focus()
      })
      await page.waitForTimeout(200)

      // Type @ to trigger mention popup
      await page.keyboard.type('@')

      // Wait for mention popup to appear (may take a moment for API call)
      const mentionPopup = page.locator('[role="listbox"]')
      await expect(mentionPopup).toBeVisible({ timeout: 10000 })

      // Type search term
      await page.keyboard.type('Popular Doc')

      // Wait for results to filter
      await page.waitForTimeout(500)

      // Wait for our document to appear in results and select it
      const docOption = page.locator('[role="option"]').filter({ hasText: 'Popular Doc' })
      await expect(docOption).toBeVisible({ timeout: 3000 })

      // Press Enter to select
      await page.keyboard.press('Enter')

      // Wait for mention to be inserted
      await expect(editor.locator('[data-type="mention"], .mention')).toBeVisible({ timeout: 3000 })

      // Wait for link sync to complete
      await page.waitForTimeout(1000)
    }

    // Navigate to Popular Doc
    await page.goto(docZUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Should show 2 backlinks (or backlinks count)
    // Scope to properties sidebar to avoid matching sidebar doc list
    const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
    await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

    const backlinksPanel = propertiesSidebar.locator('text="Backlinks"').or(
      propertiesSidebar.locator('text="Referenced by"')
    ).or(
      propertiesSidebar.locator('[data-backlinks-panel]')
    ).first()

    await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

    // Check for both referrers (within properties sidebar) using retry pattern
    await expect(async () => {
      const hasReferrer1 = await propertiesSidebar.locator('text="Referrer 1"').isVisible()
      const hasReferrer2 = await propertiesSidebar.locator('text="Referrer 2"').isVisible()
      expect(hasReferrer1 && hasReferrer2).toBeTruthy()
    }).toPass({ timeout: 10000 })
  })
})
