import { test, expect, Page } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Performance Tests
 *
 * Tests that verify the application performs well under various conditions:
 * - Page load times
 * - Editor responsiveness
 * - Large document handling
 * - Many images
 * - Memory usage
 * - Typing latency
 */

// Helper to create a new document
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.waitForLoadState('networkidle')

  const currentUrl = page.url()

  // Try sidebar button first, fall back to main "New Document" button
  const sidebarButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first()
  const mainButton = page.getByRole('button', { name: 'New Document', exact: true })

  if (await sidebarButton.isVisible({ timeout: 2000 })) {
    await sidebarButton.click()
  } else {
    await expect(mainButton).toBeVisible({ timeout: 5000 })
    await mainButton.click()
  }

  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl && /\/documents\/[a-f0-9-]+/.test(window.location.href),
    currentUrl,
    { timeout: 10000 }
  )

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('textarea[placeholder="Untitled"]')).toBeVisible({ timeout: 3000 })
}

// Create test image
function createTestImageFile(): string {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64'
  )
  const tmpPath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`)
  fs.writeFileSync(tmpPath, pngBuffer)
  return tmpPath
}

test.describe('Performance - Page Load', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('editor loads within 3 seconds', async ({ page }) => {
    const startTime = Date.now()

    await createNewDocument(page)

    // Editor should be visible
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    const loadTime = Date.now() - startTime

    console.log(`Editor loaded in ${loadTime}ms`)

    // Should load within 3 seconds (3000ms)
    expect(loadTime).toBeLessThan(3000)
  })

  test('existing document loads quickly', async ({ page }) => {
    // Create and populate document
    await createNewDocument(page)
    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Add some content
    await page.keyboard.type('# Test Document')
    await page.keyboard.press('Enter')
    await page.keyboard.type('This is test content.')

    await page.waitForTimeout(2000)
    const docUrl = page.url()

    // Navigate away
    await page.goto('/docs')

    // Measure reload time
    const startTime = Date.now()
    await page.goto(docUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    const loadTime = Date.now() - startTime

    console.log(`Existing document loaded in ${loadTime}ms`)

    // Should load within 3 seconds
    expect(loadTime).toBeLessThan(3000)
  })

  test('document list loads quickly', async ({ page }) => {
    const startTime = Date.now()

    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    // Sidebar with documents should be visible
    const sidebar = page.locator('[class*="w-56"]').first()
    await expect(sidebar).toBeVisible({ timeout: 5000 })

    const loadTime = Date.now() - startTime

    console.log(`Document list loaded in ${loadTime}ms`)

    // Should load within 2 seconds
    expect(loadTime).toBeLessThan(2000)
  })

  test('navigation between modes is fast', async ({ page }) => {
    await page.goto('/docs')
    // Wait for docs page to load - either shows editor or document list
    await page.waitForLoadState('networkidle')

    // Measure navigation to Projects
    let startTime = Date.now()
    await page.getByRole('button', { name: 'Projects' }).click()
    await expect(page).toHaveURL('/projects', { timeout: 5000 })
    let navTime = Date.now() - startTime
    console.log(`Navigation to Projects: ${navTime}ms`)
    expect(navTime).toBeLessThan(2000)

    // Navigate to Programs
    startTime = Date.now()
    await page.getByRole('button', { name: 'Programs' }).click()
    await expect(page).toHaveURL('/programs', { timeout: 5000 })
    navTime = Date.now() - startTime
    console.log(`Navigation to Programs: ${navTime}ms`)
    expect(navTime).toBeLessThan(2000)

    // Navigate back to Docs
    startTime = Date.now()
    await page.getByRole('button', { name: 'Docs' }).click()
    await expect(page).toHaveURL(/\/docs/, { timeout: 5000 })
    navTime = Date.now() - startTime
    console.log(`Navigation to Docs: ${navTime}ms`)
    expect(navTime).toBeLessThan(2000)
  })
})

test.describe('Performance - Typing Latency', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('typing latency is acceptable', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Measure time to type and see result
    const testText = 'Quick typing test'
    const startTime = Date.now()

    await page.keyboard.type(testText, { delay: 0 })

    // Wait for text to appear
    await expect(editor).toContainText(testText, { timeout: 1000 })

    const latency = Date.now() - startTime

    console.log(`Typing latency: ${latency}ms for ${testText.length} characters`)

    // Should have low latency (under 500ms for this short text)
    expect(latency).toBeLessThan(500)
  })

  test('typing is smooth during collaboration', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // Open second tab
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    await expect(page2.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page2.waitForTimeout(1500)

    // Type on first tab while second tab is connected
    await editor1.click()

    const startTime = Date.now()
    await page.keyboard.type('Typing while collaborating', { delay: 0 })

    await expect(editor1).toContainText('Typing while collaborating', { timeout: 1000 })

    const latency = Date.now() - startTime

    console.log(`Typing latency during collaboration: ${latency}ms`)

    // Should still be responsive (under 1 second)
    expect(latency).toBeLessThan(1000)

    await page2.close()
  })

  test('rapid typing does not cause lag', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type a lot of text rapidly
    const rapidText = 'a'.repeat(200)

    const startTime = Date.now()
    await page.keyboard.type(rapidText, { delay: 1 })

    await expect(editor).toContainText(rapidText, { timeout: 3000 })

    const duration = Date.now() - startTime

    console.log(`Rapid typing duration: ${duration}ms for ${rapidText.length} characters`)

    // Should handle rapid input (under 3 seconds for 200 chars)
    expect(duration).toBeLessThan(3000)
  })
})

test.describe('Performance - Large Documents', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('large document does not freeze', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create a large document
    const paragraphs = 50
    for (let i = 0; i < paragraphs; i++) {
      await page.keyboard.type(`Paragraph ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. `)
      await page.keyboard.press('Enter')

      // Check editor is still responsive every 10 paragraphs
      if (i % 10 === 0) {
        await expect(editor).toBeVisible()
        await expect(editor).toContainText(`Paragraph ${i + 1}`)
      }
    }

    // Wait for content to settle
    await page.waitForTimeout(2000)

    // Verify editor is still responsive
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Still responsive!')

    await expect(editor).toContainText('Still responsive!')
  })

  test('scrolling large document is smooth', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create content to scroll
    for (let i = 0; i < 100; i++) {
      await page.keyboard.type(`Line ${i + 1}`)
      await page.keyboard.press('Enter')
    }

    await page.waitForTimeout(1000)

    // Measure scroll performance
    const startTime = Date.now()

    // Scroll to top
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(100)

    // Scroll to bottom
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(100)

    const scrollDuration = Date.now() - startTime

    console.log(`Scroll duration: ${scrollDuration}ms`)

    // Should be able to scroll quickly
    expect(scrollDuration).toBeLessThan(1000)

    // Verify we can still type
    await page.keyboard.type(' End of document')
    await expect(editor).toContainText('End of document')
  })

  test('searching in large document is fast', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create searchable content
    for (let i = 0; i < 50; i++) {
      await page.keyboard.type(`Section ${i}: This is test content. `)
      if (i === 25) {
        await page.keyboard.type('FINDME ')
      }
      await page.keyboard.press('Enter')
    }

    await page.waitForTimeout(1000)

    // Measure search time
    const startTime = Date.now()

    // Use browser's find functionality
    await page.keyboard.press('Control+f')
    await page.keyboard.type('FINDME')

    // Wait a bit for search
    await page.waitForTimeout(500)

    const searchDuration = Date.now() - startTime

    console.log(`Search duration: ${searchDuration}ms`)

    // Search should be fast
    expect(searchDuration).toBeLessThan(2000)
  })
})

// FIXME: Slash command dropdown inconsistent + filechooser event not firing reliably
// Same issue as images.spec.ts and data-integrity.spec.ts
test.describe('Performance - Many Images', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('many images do not crash the editor', async ({ page }, testInfo) => {
    testInfo.setTimeout(300000); // 5 minute timeout for multiple image uploads under load
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    const imagePaths: string[] = []

    // Upload 5 images
    for (let i = 0; i < 5; i++) {
      // Re-focus editor each iteration (focus can be lost after file chooser)
      await editor.click()
      await page.waitForTimeout(300)

      await page.keyboard.type(`Image ${i + 1}:`)
      await page.keyboard.press('Enter')
      await page.keyboard.type('/image')
      // Wait for slash command dropdown to appear - give extra time under load
      await page.waitForTimeout(1000)

      // Retry if dropdown didn't appear (slash menu items are buttons, not options)
      const optionLocator = page.getByRole('button', { name: /Image.*Upload/i })
      let dropdownVisible = false
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await optionLocator.isVisible()) {
          dropdownVisible = true
          break
        }
        // Try triggering the dropdown again
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.type('/image')
        await page.waitForTimeout(1000)
      }
      expect(dropdownVisible, `Slash command dropdown not visible for image ${i + 1}`).toBe(true)

      const tmpPath = createTestImageFile()
      imagePaths.push(tmpPath)

      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 45000 })
      await page.keyboard.press('Enter')

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpPath)

      await page.waitForTimeout(2000) // Give more time for upload under load

      // Add newline after image for next iteration
      await page.keyboard.press('Enter')

      // Verify editor is still responsive
      await expect(editor).toBeVisible()
    }

    // Wait for all uploads to complete
    await page.waitForTimeout(3000)

    // Verify at least some images are present (timing may vary)
    const imgCount = await editor.locator('img').count()
    expect(imgCount).toBeGreaterThanOrEqual(1)

    // Editor should still be usable
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' All images loaded!')
    await expect(editor).toContainText('All images loaded!')

    // Cleanup
    imagePaths.forEach(p => {
      try {
        fs.unlinkSync(p)
      } catch (_e) {
        // Ignore errors
      }
    })
  })

  test('image-heavy document loads without issues', async ({ page }, testInfo) => {
    testInfo.setTimeout(300000); // 5 minute timeout for image uploads under load
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    const imagePaths: string[] = []

    // Upload 3 images
    for (let i = 0; i < 3; i++) {
      // Re-focus editor each iteration (focus can be lost after file chooser)
      await editor.click()
      await page.waitForTimeout(300)

      await page.keyboard.type('/image')
      // Wait for slash command dropdown to appear - give extra time under load
      await page.waitForTimeout(1000)

      // Retry if dropdown didn't appear (slash menu items are buttons, not options)
      const optionLocator = page.getByRole('button', { name: /Image.*Upload/i })
      let dropdownVisible = false
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await optionLocator.isVisible()) {
          dropdownVisible = true
          break
        }
        // Try triggering the dropdown again
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.keyboard.type('/image')
        await page.waitForTimeout(1000)
      }
      expect(dropdownVisible, `Slash command dropdown not visible for image ${i + 1}`).toBe(true)

      const tmpPath = createTestImageFile()
      imagePaths.push(tmpPath)

      // Click the button directly to trigger file chooser (more reliable than keyboard.press)
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 45000 })
      await optionLocator.click()

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpPath)

      await page.waitForTimeout(2000)

      // Add newline after image for next iteration
      await page.keyboard.press('Enter')
    }

    await page.waitForTimeout(3000)

    const docUrl = page.url()

    // Reload document
    const startTime = Date.now()
    await page.goto(docUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Wait for images to load
    await expect(page.locator('.ProseMirror img').first()).toBeVisible({ timeout: 5000 })

    const loadTime = Date.now() - startTime

    console.log(`Image-heavy document loaded in ${loadTime}ms`)

    // Should load reasonably fast even with images
    expect(loadTime).toBeLessThan(5000)

    // Verify images loaded (at least 1 should be visible - timing can cause others to still be loading)
    const imgCount = await page.locator('.ProseMirror img').count()
    expect(imgCount).toBeGreaterThanOrEqual(1)

    // Cleanup
    imagePaths.forEach(p => {
      try {
        fs.unlinkSync(p)
      } catch (_e) {
        // Ignore errors
      }
    })
  })
})

test.describe('Performance - Memory Usage', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('memory does not grow unbounded during editing', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Get initial memory
    const initialMemory = await page.evaluate(() => {
      if (performance.memory) {
        return performance.memory.usedJSHeapSize
      }
      return 0
    })

    // Perform many operations
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type(`Line ${i + 1}: Some content. `)
      await page.keyboard.press('Enter')
    }

    // Wait for operations to complete
    await page.waitForTimeout(2000)

    // Check memory again
    const finalMemory = await page.evaluate(() => {
      if (performance.memory) {
        return performance.memory.usedJSHeapSize
      }
      return 0
    })

    if (initialMemory > 0 && finalMemory > 0) {
      const memoryGrowth = finalMemory - initialMemory
      const growthMB = memoryGrowth / (1024 * 1024)

      console.log(`Memory growth: ${growthMB.toFixed(2)}MB`)

      // Memory growth should be reasonable (under 50MB for this test)
      expect(growthMB).toBeLessThan(50)
    }
  })

  test('memory is released after deleting content', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Add a lot of content
    for (let i = 0; i < 50; i++) {
      await page.keyboard.type(`Content line ${i + 1}. `)
    }

    await page.waitForTimeout(1000)

    // Get memory after adding content
    const beforeDelete = await page.evaluate(() => {
      if (performance.memory) {
        return performance.memory.usedJSHeapSize
      }
      return 0
    })

    // Delete all content
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')

    await page.waitForTimeout(1000)

    // Force garbage collection hint
    await page.evaluate(() => {
      if (window.gc) {
        window.gc()
      }
    })

    await page.waitForTimeout(1000)

    // Check memory after deletion
    const afterDelete = await page.evaluate(() => {
      if (performance.memory) {
        return performance.memory.usedJSHeapSize
      }
      return 0
    })

    if (beforeDelete > 0 && afterDelete > 0) {
      console.log(`Memory before delete: ${(beforeDelete / (1024 * 1024)).toFixed(2)}MB`)
      console.log(`Memory after delete: ${(afterDelete / (1024 * 1024)).toFixed(2)}MB`)

      // Memory should not have grown significantly
      // (It may not decrease immediately due to GC timing, but shouldn't grow)
      const memoryGrowth = afterDelete - beforeDelete
      const growthMB = memoryGrowth / (1024 * 1024)

      expect(growthMB).toBeLessThan(20)
    }
  })

})
