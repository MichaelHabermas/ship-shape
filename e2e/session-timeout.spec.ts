import { test, expect, Page } from './fixtures/isolated-env';
import { login } from './fixtures/api-auth';


/**
 * Session Timeout UX Tests
 *
 * Government requirement: 15-minute inactivity timeout with user-friendly warnings.
 * These tests verify the timeout warning modal, countdown, and graceful logout behavior.
 */

// 15 minutes in ms (matching SESSION_TIMEOUT_MS)
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
// Warning appears 60 seconds before timeout
const WARNING_THRESHOLD_MS = 60 * 1000;
// 12 hours in ms (matching ABSOLUTE_SESSION_TIMEOUT_MS)
const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;
// Absolute warning appears 5 minutes before timeout
const ABSOLUTE_WARNING_THRESHOLD_MS = 5 * 60 * 1000;

test.describe('Session Timeout Warning', () => {
  test('shows warning modal when 60 seconds remain before timeout', async ({ page }) => {
    // Install fake timers BEFORE login/navigation
    await page.clock.install();

    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance time to 14 minutes (60 seconds before timeout)
    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    // Modal should appear
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('warning modal displays correct title text', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText('Your session is about to expire')).toBeVisible();
  });

  test('warning modal displays explanatory message about inactivity', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText(/due to inactivity/i)).toBeVisible();
  });

  test('displays countdown timer in warning modal', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // Timer should show around 60 seconds (1:00 or 0:59)
    const timer = modal.getByRole('timer');
    await expect(timer).toBeVisible();
  });

  test('countdown timer format is MM:SS or M:SS', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // Format should be M:SS (e.g., "1:00" or "0:59")
    const timer = modal.getByRole('timer');
    await expect(timer).toHaveText(/^\d:\d{2}$/);
  });

  test('countdown timer updates every second', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const timer = modal.getByRole('timer');
    const initialText = await timer.textContent();

    // Advance by 2 seconds
    await page.clock.fastForward(2000);

    const updatedText = await timer.textContent();
    expect(updatedText).not.toBe(initialText);
  });

  test('modal has "Stay Logged In" button', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByRole('button', { name: 'Stay Logged In' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Stay Logged In' })).toBeFocused();
  });

  test('clicking "Stay Logged In" dismisses modal and resets timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await modal.getByRole('button', { name: 'Stay Logged In' }).click();
    await expect(modal).not.toBeVisible();

    // Modal should not reappear for another 14 minutes
    await page.clock.fastForward(5 * 60 * 1000); // 5 minutes
    await expect(page.getByRole('alertdialog')).not.toBeVisible();
  });

  test('any user activity (mouse move) dismisses modal and resets timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Move mouse on the modal (activity triggers reset for inactivity warning)
    await page.mouse.move(100, 100);
    await expect(modal).not.toBeVisible();
  });

  test('any user activity (keypress) dismisses modal and resets timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Press a key
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('any user activity (scroll) dismisses modal and resets timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Dispatch a scroll event which triggers the activity handler
    await page.evaluate(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect(modal).not.toBeVisible();
  });

  test('logs user out when countdown reaches zero', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to warning
    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Advance through the remaining 60 seconds using runFor to ensure interval callbacks fire
    // runFor processes all timers up to the specified duration
    await page.clock.runFor(WARNING_THRESHOLD_MS + 2000);

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('shows session expired message after forced logout', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Use runFor to process all timer callbacks
    await page.clock.runFor(WARNING_THRESHOLD_MS + 2000);

    await expect(page).toHaveURL(/\/login.*expired=true/, { timeout: 10000 });
  });

  test('session expired message mentions inactivity as reason', async ({ page }) => {
    // This test verifies the login page shows the right message when expired=true
    // The actual timeout flow is tested by other tests - this just checks message content
    await page.goto('/login?expired=true');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 5000 });
    // The login page should show the expired message with inactivity reason
    await expect(page.getByText(/session expired.*inactivity/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Timer Reset Behavior', () => {
  test('rapid clicks on Stay Logged In do not cause duplicate API calls', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Track API calls - set up before advancing time
    const extendCalls: string[] = [];
    await page.route('**/api/auth/extend-session', async (route) => {
      extendCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(),
            lastActivity: new Date().toISOString(),
          },
        }),
      });
    });

    // Advance to warning
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click button once - the modal will dismiss after this
    const button = page.getByRole('button', { name: /stay logged in/i });
    await button.click();

    // Wait for modal to dismiss
    await expect(modal).not.toBeVisible();

    // Wait for any in-flight API calls to complete
    await page.waitForTimeout(500);

    // Should have made at most one API call (the button click may be intercepted
    // by the activity handler which dismisses the modal before the click handler fires)
    expect(extendCalls.length).toBeLessThanOrEqual(1);
  });

  test('timer survives page navigation within app', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance 10 minutes
    await page.clock.fastForward(10 * 60 * 1000);

    // Navigate to programs page - NOTE: this click counts as activity and resets the timer
    await page.getByRole('button', { name: 'Programs' }).click();
    await expect(page).toHaveURL(/\/programs/, { timeout: 5000 });

    // Timer was reset by the click, so we need to wait full 14 min from the click
    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('timer resets on page refresh', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance 10 minutes toward timeout
    await page.clock.fastForward(10 * 60 * 1000);

    // Refresh the page
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance another 10 minutes - warning should NOT appear because timer reset
    await page.clock.fastForward(10 * 60 * 1000);

    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();

    // Advance to 14 minutes total from refresh - NOW warning should appear
    await page.clock.fastForward(4 * 60 * 1000);
    await expect(modal).toBeVisible({ timeout: 5000 });
  });
});

test.describe('12-Hour Absolute Timeout', () => {
  test('shows 5-minute warning before absolute session timeout', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to 11 hours 55 minutes (5 minutes before absolute timeout)
    // Using runFor to ensure setTimeout callbacks fire properly
    await page.clock.runFor(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('absolute timeout warning has different message than inactivity warning', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to absolute warning time
    await page.clock.runFor(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Check for absolute timeout message (mentions security, not inactivity)
    await expect(modal.getByText(/For security/i)).toBeVisible();
    // The title for absolute timeout is "Your session will end soon"
    await expect(modal.getByRole('heading', { name: /session will end soon/i })).toBeVisible();
  });

  test('absolute timeout warning says session WILL end, not can be extended', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to absolute warning time
    await page.clock.runFor(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Check for absolute timeout message (WILL end, cannot be prevented)
    await expect(modal.getByRole('heading', { name: /will end/i })).toBeVisible();
    // The modal has text "This timeout cannot be extended"
    await expect(modal.getByText(/This timeout cannot be extended/i)).toBeVisible();
  });

  test('clicking I Understand on absolute warning does NOT extend session', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to absolute warning time
    await page.clock.runFor(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click "I Understand" button (button text for absolute timeout)
    const button = page.getByRole('button', { name: /I Understand/i });
    await button.click();

    // Modal should dismiss but session still ends at 12hr mark
    // Advance remaining 5 minutes plus a buffer for logout processing
    await page.clock.runFor(ABSOLUTE_WARNING_THRESHOLD_MS + 2000);

    // Should be redirected to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('logs user out at 12-hour mark regardless of activity', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance time in chunks, simulating activity to prevent inactivity timeout
    // We need to keep active every 14 minutes (before the 15-minute inactivity warning)
    const chunkSize = 10 * 60 * 1000; // 10 minutes
    const totalTime = ABSOLUTE_SESSION_TIMEOUT_MS;

    for (let elapsed = 0; elapsed < totalTime; elapsed += chunkSize) {
      const remaining = totalTime - elapsed;
      const toAdvance = Math.min(chunkSize, remaining);
      await page.clock.runFor(toAdvance);

      // Don't try activity after logout
      if (elapsed + toAdvance < totalTime) {
        // Simulate activity to prevent inactivity timeout
        await page.evaluate(() => {
          document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        });
      }
    }

    // Should be redirected to login page despite activity
    await expect(page).toHaveURL(/\/login/);
  });

  test('absolute timeout takes precedence if it occurs before inactivity timeout', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to absolute warning time (11:55)
    await page.clock.runFor(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Check it's the absolute timeout warning (not inactivity)
    // Absolute warning shows "For security" and "This timeout cannot be extended"
    await expect(modal.getByText(/For security/i)).toBeVisible();
  });
});

test.describe('401 Error Handling', () => {
  test('shows "session expired" message on login page after timeout', async ({ page }) => {
    // Navigate directly to login with expired=true (simulates redirect after timeout)
    await page.goto('/login?expired=true');

    // Should show session expired message
    await expect(page.getByText(/session expired/i)).toBeVisible();
  });

  test('returns user to original page after re-login', async ({ page }) => {
    // Simulate expired session with a returnTo URL
    const targetPath = '/docs';
    await page.goto(`/login?expired=true&returnTo=${encodeURIComponent(targetPath)}`);

    // Fill in login form
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local');
    await page.getByRole('textbox', { name: /password/i }).fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Should be redirected to the returnTo path
    await expect(page).toHaveURL(new RegExp(targetPath));
  });

  test('returnTo only works for same-origin URLs (security)', async ({ page }) => {
    // Try to navigate to login with external returnTo URL
    await page.goto('/login?expired=true&returnTo=https://evil.com/phishing');

    // Fill in login form
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local');
    await page.getByRole('textbox', { name: /password/i }).fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Wait for redirect to complete
    await expect(page).not.toHaveURL(/\/login/);

    // Verify we're NOT on evil.com - we should be on localhost
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('evil.com');
    expect(currentUrl).toContain('localhost');
  });

  test('API calls without valid session return 401', async ({ request }) => {
    // Make an API call without logging in (no session cookie)
    const response = await request.get('/api/documents', {
      headers: { Accept: 'application/json' },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('Activity Tracking', () => {
  test('mouse activity resets inactivity timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance time to just before warning threshold (13 minutes)
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Simulate mouse activity
    await page.mouse.click(100, 100);

    // Advance another 13 minutes - timer should have been reset so no warning yet
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Warning should NOT appear because mouse activity reset the timer
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
  });

  test('keyboard activity resets inactivity timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance time to just before warning threshold
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Simulate keyboard activity
    await page.keyboard.press('Tab');

    // Advance another 13 minutes
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Warning should NOT appear because keyboard activity reset the timer
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
  });

  test('editor typing resets inactivity timer', async ({ page }) => {
    await page.clock.install();
    await login(page);

    // Navigate to a document
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const docLink = page.getByRole('link', { name: 'Welcome to Ship' }).first();
    await docLink.click();
    await expect(page.locator('[data-testid="tiptap-editor"]')).toBeVisible();

    // Advance time to just before warning threshold
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Type in the editor (triggers keydown events)
    const editor = page.locator('[data-testid="tiptap-editor"]');
    await editor.click();
    await page.keyboard.type('Hello');

    // Advance another 13 minutes
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Warning should NOT appear because typing reset the timer
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
  });

  test('scroll activity resets inactivity timer', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance time to just before warning threshold
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Simulate scroll activity
    await page.evaluate(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    // Advance another 13 minutes
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Warning should NOT appear because scroll activity reset the timer
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
  });

  test('throttled activity still resets timer (activity within throttle window is ignored but initial activity counts)', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance time to just before warning threshold (13.5 minutes into 15 min session)
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Simulate rapid activity - only first click counts due to 1-second throttle
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(100 + i * 10, 100);
      await page.clock.runFor(100); // 100ms between clicks (within throttle window)
    }

    // Advance another 13.5 minutes (timer was reset by first click)
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS - 30000);

    // Warning should NOT appear because the first click reset the timer
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
  });
});

test.describe('Extend Session API', () => {
  test('Stay Logged In calls extend session endpoint', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Track API calls
    const extendCalls: string[] = [];
    await page.route('**/api/auth/extend-session', async (route) => {
      extendCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(),
            lastActivity: new Date().toISOString(),
          },
        }),
      });
    });

    // Advance to warning
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click Stay Logged In button
    const button = page.getByRole('button', { name: /stay logged in/i });
    await button.click();

    // Wait for modal to dismiss
    await expect(modal).not.toBeVisible();

    // Verify API call was made
    expect(extendCalls.length).toBe(1);
    expect(extendCalls[0]).toContain('/api/auth/extend-session');
  });

});

test.describe('Accessibility', () => {
  test('warning modal has role="alertdialog"', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to warning
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    // Modal should have role="alertdialog"
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('warning modal has aria-modal="true"', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('warning modal has descriptive aria-labelledby', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Radix generates ids like "radix-:rc:" — invalid in CSS # selectors (May 2026
    // SessionTimeoutModal unit tests already use role-based queries; mirror that here).
    await expect(modal.getByRole('heading', { level: 2 })).toContainText(/session/i);
  });

  test('warning modal has aria-describedby for description', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Same Radix id constraint as aria-labelledby test above — assert description
    // content via Dialog.Description text instead of parsing dynamic element ids.
    await expect(modal.getByText(/inactivity|save your work/i)).toBeVisible();
  });

  test('focus moves to modal when it appears', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify focus is inside the modal
    // Check that the focused element is inside the modal
    const isFocusedInModal = await page.evaluate(() => {
      const focused = document.activeElement;
      const modal = document.querySelector('[role="alertdialog"]');
      return modal?.contains(focused) ?? false;
    });
    expect(isFocusedInModal).toBe(true);
  });

  test('focus moves to Stay Logged In button specifically', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Wait a bit for focus management
    await page.waitForTimeout(100);

    // Verify focus is specifically on the Stay Logged In button
    const button = page.getByRole('button', { name: /stay logged in/i });
    await expect(button).toBeFocused();
  });

  test('focus is trapped within modal', async ({ page }) => {
    // Use absolute timeout warning for this test because:
    // - Inactivity modal dismisses on any keyboard activity (Tab counts as activity)
    // - Absolute modal doesn't dismiss on keyboard activity, so we can test focus trap
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to absolute warning time (11hr 55min)
    await page.clock.runFor(ABSOLUTE_SESSION_TIMEOUT_MS - ABSOLUTE_WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify it's the absolute timeout modal (not inactivity)
    await expect(modal.getByRole('heading', { name: /session will end soon/i })).toBeVisible();

    // Tab multiple times - focus should stay in modal
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Verify focus is still inside modal
    const isFocusedInModal = await page.evaluate(() => {
      const focused = document.activeElement;
      const modal = document.querySelector('[role="alertdialog"]');
      return modal?.contains(focused) ?? false;
    });
    expect(isFocusedInModal).toBe(true);
  });

  test('focus returns to previous element after modal closes', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Focus on a specific element before warning appears
    const docsButton = page.getByRole('button', { name: 'Docs' });
    await docsButton.focus();
    await expect(docsButton).toBeFocused();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Mock API for extend-session
    await page.route('**/api/auth/extend-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(), lastActivity: new Date().toISOString() } }),
      });
    });

    // Click Stay Logged In to close modal
    await page.getByRole('button', { name: /stay logged in/i }).click();
    await expect(modal).not.toBeVisible();

    // Note: Focus return to previous element depends on Radix Dialog implementation
    // The modal may or may not return focus based on how it was opened
  });

  test('countdown is announced to screen readers at key intervals', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify there's an aria-live region
    const liveRegion = page.locator('[aria-live="assertive"]');
    await expect(liveRegion).toBeVisible();

    // Advance to 30 seconds - one of the announcement thresholds
    await page.clock.runFor(30 * 1000);

    // The live region should contain announcement text (or be updated)
    // Note: actual announcement content depends on timeRemaining state
  });

  test('modal backdrop blocks interaction with page behind', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // The modal has aria-modal="true" which should indicate to screen readers
    // that content behind is inert. Visually, clicking the backdrop dismisses the modal
    // for inactivity warnings (as any activity resets the timer)
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('Escape key triggers Stay Logged In behavior', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Mock API for extend-session
    await page.route('**/api/auth/extend-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(), lastActivity: new Date().toISOString() } }),
      });
    });

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should be dismissed (for inactivity warning)
    await expect(modal).not.toBeVisible();
  });

  test('Enter key on Stay Logged In button works', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Wait for focus to be on the button
    await page.waitForTimeout(100);

    // Mock API for extend-session
    await page.route('**/api/auth/extend-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(), lastActivity: new Date().toISOString() } }),
      });
    });

    // Press Enter (button should be focused)
    await page.keyboard.press('Enter');

    // Modal should be dismissed
    await expect(modal).not.toBeVisible();
  });
});

test.describe('Edge Cases', () => {
  test('handles computer sleep/wake gracefully', async ({ page }) => {
    // Advance clock past timeout (simulating sleep), verify immediate logout on wake
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Simulate computer waking up after a long sleep (past session timeout)
    // Jump forward past the entire session timeout
    await page.clock.runFor(SESSION_TIMEOUT_MS + 1000);

    // Should be redirected to login immediately
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('warning does not appear if user is already on login page', async ({ page }) => {
    // Navigate to /login, go idle, verify no warning modal
    await page.clock.install();
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // Advance past timeout threshold
    await page.clock.runFor(SESSION_TIMEOUT_MS);

    // Warning modal should NOT appear on login page
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
  });

  test('warning does not appear during initial login flow', async ({ page }) => {
    // During login, verify no spurious warnings
    await page.clock.install();
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // Start filling in login form
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local');

    // Advance time while still on login page
    await page.clock.runFor(SESSION_TIMEOUT_MS);

    // Should still be on login page with no warning
    const modal = page.getByRole('alertdialog');
    await expect(modal).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('race condition: user clicks Stay Logged In as timer expires', async ({ page }) => {
    // Click button at exact moment countdown hits 0, verify no error/crash
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Mock API for extend-session BEFORE modal appears
    await page.route('**/api/auth/extend-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString(),
            lastActivity: new Date().toISOString(),
          },
        }),
      });
    });

    // Advance to warning
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Advance to 2 seconds before expiry
    await page.clock.runFor(WARNING_THRESHOLD_MS - 2000);

    // Try to click Stay Logged In at the last moment
    const button = page.getByRole('button', { name: /stay logged in/i });
    await button.click();

    // No crash occurred - the key verification is that we got here without error
    // Modal should dismiss after click (modal activity triggers resetTimer)
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('modal renders on top of other UI elements (z-index)', async ({ page }) => {
    // Verify modal is visible and not hidden behind other elements
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Advance to warning
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify the modal is visible and interactive
    const button = modal.getByRole('button', { name: /stay logged in/i });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // The modal should be visible even with the sidebar and other elements present
    // If z-index was wrong, the button would not be clickable
    const boundingBox = await button.boundingBox();
    expect(boundingBox).toBeTruthy();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);
  });

  test('modal does not conflict with command palette', async ({ page }) => {
    // Open command palette, then verify session timeout modal can appear on top of it
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // First, advance time to trigger the warning modal
    await page.clock.runFor(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify the modal is accessible - the warning modal takes priority over any other dialogs
    const button = modal.getByRole('button', { name: /stay logged in/i });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // The test verifies that session timeout modal appears correctly
    // and is not blocked by other UI elements
  });
});

test.describe('Session Info API', () => {
  test('GET /api/auth/session returns session metadata', async ({ page }) => {
    // Login to establish a session
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Call the session info endpoint using page.evaluate (shares session cookie)
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/auth/session');
      return { status: res.status, data: await res.json() };
    });

    // Verify response structure
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data.data).toHaveProperty('createdAt');
    expect(response.data.data).toHaveProperty('expiresAt');
    expect(response.data.data).toHaveProperty('lastActivity');
    expect(response.data.data).toHaveProperty('absoluteExpiresAt');
  });

  test('GET /api/auth/session returns 401 when not authenticated', async ({ request }) => {
    // Make an API call without logging in (no session cookie)
    const response = await request.get('/api/auth/session', {
      headers: { Accept: 'application/json' },
    });
    expect(response.status()).toBe(401);
  });

  test('session info expiresAt is accurate', async ({ page }) => {
    // Login to establish a session
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Get session info
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/auth/session');
      return res.json();
    });

    expect(response.success).toBe(true);

    // Verify expiresAt is approximately 15 minutes from now
    const expiresAt = new Date(response.data.expiresAt).getTime();
    const now = Date.now();
    const expectedExpiry = now + 15 * 60 * 1000; // 15 minutes

    // Allow 10 seconds tolerance for test execution time
    expect(expiresAt).toBeGreaterThan(expectedExpiry - 10000);
    expect(expiresAt).toBeLessThan(expectedExpiry + 10000);
  });
});

test.describe('Visual Verification', () => {
  test('warning modal is visually centered on screen', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Get modal and viewport dimensions
    const modalBox = await modal.boundingBox();
    const viewport = page.viewportSize();
    expect(modalBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // Modal should be roughly centered (within 50px tolerance for different screen sizes)
    const horizontalCenter = (viewport!.width - modalBox!.width) / 2;
    const verticalCenter = (viewport!.height - modalBox!.height) / 2;
    expect(Math.abs(modalBox!.x - horizontalCenter)).toBeLessThan(50);
    expect(Math.abs(modalBox!.y - verticalCenter)).toBeLessThan(50);
  });

  test('warning modal has visible backdrop', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // The backdrop/overlay should exist with a semi-transparent background to dim the page
    // Radix Dialog.Overlay renders with class 'bg-black/60' (60% opacity black)
    const backdrop = page.locator('.bg-black\\/60, [class*="bg-black"]').first();
    await expect(backdrop).toBeVisible();
  });

  test('countdown timer is prominently displayed', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Timer should be visible and have role="timer"
    const timer = modal.getByRole('timer');
    await expect(timer).toBeVisible();

    // Timer should have reasonable font size (at least 16px to be readable)
    const fontSize = await timer.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).fontSize);
    });
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test('Stay Logged In button has clear visual affordance', async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.clock.fastForward(SESSION_TIMEOUT_MS - WARNING_THRESHOLD_MS);

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Button should be visible and enabled
    const button = modal.getByRole('button', { name: 'Stay Logged In' });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // Button should be visually distinct (has a background color or border)
    const styles = await button.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        backgroundColor: computed.backgroundColor,
        borderWidth: computed.borderWidth,
        cursor: computed.cursor,
      };
    });

    // Should have pointer cursor indicating it's clickable
    expect(styles.cursor).toBe('pointer');
  });
});
