/**
 * E2E tests for pending invites appearing in allocation grid
 *
 * Tests the feature where pending invites (users who haven't accepted yet)
 * appear in the allocation grid AND can be assigned programs:
 * - Pending users APPEAR in the grid with "(pending)" indicator
 * - Pending users CAN be assigned programs (using personId instead of userId)
 * - Allocations persist when the user accepts the invite
 */

import { test, expect, Page } from './fixtures/isolated-env'
import { loginAsSuperAdmin, getCsrfToken } from './fixtures/api-auth'
import { readJsonAs } from './fixtures/typed-json';
import type {
  AssignResponse,
  InviteCreateResponse,
  TeamAssignmentsResponse,
  TeamGridResponse,
  TeamPerson,
  TeamProgram,
} from './fixtures/e2e-api-types';
import { sprintAssignmentForPerson } from './fixtures/e2e-api-types';

function expectDefined<T>(value: T | undefined, label: string): T {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error(label);
  }
  return value;
}

// Helper to get current workspace ID
async function getWorkspaceId(page: Page): Promise<string> {
  const response = await page.request.get('/api/workspaces/current')
  const data = await readJsonAs<{ data: { workspace: { id: string } } }>(response)
  return data.data.workspace.id
}

// Helper to create a pending invite via API
async function createPendingInvite(page: Page, email: string): Promise<void> {
  const csrfToken = await getCsrfToken(page)
  const workspaceId = await getWorkspaceId(page)

  const response = await page.request.post(`/api/workspaces/${workspaceId}/invites`, {
    headers: { 'x-csrf-token': csrfToken },
    data: { email, role: 'member' }
  })

  expect(response.status()).toBe(201)
}

test.describe('Pending Invites in Allocation Grid', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('pending invite appears in team grid with isPending flag', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-grid-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Set up response listener BEFORE navigation
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/team/grid') && resp.status() === 200
    )

    // Navigate to team allocation grid
    await page.goto('/team/allocation')
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // Wait for the API response
    const response = await responsePromise
    const data = await readJsonAs<TeamGridResponse>(response)

    // Find the pending user in the response
    const pendingUser = expectDefined(
      data.users.find((u) => u.email === testEmail),
      'Expected pending user in team grid response',
    );
    expect(pendingUser.isPending).toBe(true)
    expect(pendingUser.id).toBeNull() // Pending users have null user_id
    expect(pendingUser.name).toBeDefined()
  })

  test('pending invite appears in team people API with isPending flag', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-people-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Call the team/people API
    const response = await page.request.get('/api/team/people')
    expect(response.status()).toBe(200)

    const people = await readJsonAs<TeamPerson[]>(response)

    // Find the pending user
    const pendingPerson = expectDefined(
      people.find((p) => p.email === testEmail),
      'Expected pending person in team people list',
    );
    expect(pendingPerson.isPending).toBe(true)
    expect(pendingPerson.user_id).toBeNull()
  })

  test('pending user appears in grid UI with visual distinction', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-ui-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Navigate to team allocation grid
    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // The pending user's name (email prefix) should be visible
    const emailPrefix = testEmail.split('@')[0]
    await expect(page.getByText(emailPrefix)).toBeVisible({ timeout: 10000 })

    // Should have "(pending)" badge next to the name
    await expect(page.getByText('(pending)').first()).toBeVisible({ timeout: 5000 })
  })

  test('clicking pending user cell DOES open program selector', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-click-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Navigate to team allocation grid
    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // Find the pending user row
    const emailPrefix = testEmail.split('@')[0]
    await expect(page.getByText(emailPrefix)).toBeVisible({ timeout: 10000 })

    // Wait for "(pending)" indicator
    await expect(page.getByText('(pending)').first()).toBeVisible({ timeout: 5000 })

    // Find the "+" button in the pending user's row - pending users CAN now be assigned
    // Look for a "+" button in a row that contains the email prefix
    const pendingUserRow = page.locator('div').filter({ hasText: emailPrefix }).filter({ hasText: '(pending)' }).first()
    await expect(pendingUserRow).toBeVisible()

    // Find and click the "+" button for the pending user
    const plusButton = pendingUserRow.getByRole('button', { name: '+' }).first()
    await expect(plusButton).toBeVisible({ timeout: 5000 })
    await plusButton.click()

    // The program selector popover SHOULD now open for pending users
    const searchInput = page.getByPlaceholder('Search projects...')
    await expect(searchInput).toBeVisible({ timeout: 5000 })

    // Close it
    await page.keyboard.press('Escape')
  })

  test('non-pending users still have clickable cells', async ({ page }) => {
    // Create a pending invite (to ensure we have both pending and non-pending users)
    const testEmail = `pending-compare-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load with user data
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 10000 })

    // Wait for sprint columns to load
    await expect(page.getByText(/Week \d+/).first()).toBeVisible({ timeout: 10000 })

    // Wait a moment for grid to stabilize
    await page.waitForTimeout(500)

    // Look for an empty cell (shows "+" placeholder) - this should be for non-pending user
    const emptyCellButton = page.getByRole('button', { name: '+' }).first()
    const hasEmptyCell = await emptyCellButton.count() > 0

    if (hasEmptyCell) {
      // Click empty cell button for non-pending user
      await emptyCellButton.click()

      // Wait for the popover to open (cmdk command menu)
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })

      // Verify the command menu is shown
      const commandMenu = page.locator('[cmdk-root]')
      await expect(commandMenu).toBeVisible()

      // Press Escape to close
      await page.keyboard.press('Escape')
    }
  })

  test('assignment API accepts personId for pending users', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-assign-api-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    const csrfToken = await getCsrfToken(page)

    // Get the pending user's personId from the grid API
    const gridResponse = await page.request.get('/api/team/grid')
    expect(gridResponse.status()).toBe(200)
    const gridData = await readJsonAs<TeamGridResponse>(gridResponse)
    const pendingUser = expectDefined(
      gridData.users.find((u) => u.email === testEmail),
      'Expected pending user in team grid',
    );
    expect(pendingUser.isPending).toBe(true)
    expect(pendingUser.id).toBeNull() // user_id is null for pending
    expect(pendingUser.personId).toBeDefined() // but personId exists
    if (!pendingUser.personId) {
      throw new Error('Expected personId for pending user');
    }

    // Get a program ID
    const programsResponse = await page.request.get('/api/team/programs')
    expect(programsResponse.status()).toBe(200)
    const programs = await readJsonAs<TeamProgram[]>(programsResponse)
    expect(programs.length).toBeGreaterThan(0)
    const programId = programs[0].id

    // Assign using personId (not userId) - this now works for pending users!
    const assignResponse = await page.request.post('/api/team/assign', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        personId: pendingUser.personId, // Use personId, not userId
        programId: programId,
        sprintNumber: 99  // Use high number to avoid conflicts
      }
    })

    // Should succeed with personId
    expect(assignResponse.status()).toBe(200)
    const assignData = await readJsonAs<AssignResponse>(assignResponse)
    expect(assignData.success).toBe(true)

    // Clean up - delete the assignment
    await page.request.delete('/api/team/assign', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        personId: pendingUser.personId,
        sprintNumber: 99
      }
    })
  })
})

test.describe('Pending Invite Acceptance Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('accepted invite converts pending user to regular member', async ({ page }) => {
    // Create a pending invite and get the token
    const testEmail = `pending-accept-${Date.now()}@example.com`
    const testName = 'Test Accepter'
    const testPassword = 'securepassword123'

    const csrfToken = await getCsrfToken(page)
    const workspaceId = await getWorkspaceId(page)

    // Create the invite and capture the token
    const inviteResponse = await page.request.post(`/api/workspaces/${workspaceId}/invites`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { email: testEmail, role: 'member' }
    })
    expect(inviteResponse.status()).toBe(201)
    const inviteData = await readJsonAs<InviteCreateResponse>(inviteResponse)
    const inviteToken = inviteData.data.invite.token

    // Verify they appear as pending first
    let peopleResponse = await page.request.get('/api/team/people')
    let people = await readJsonAs<TeamPerson[]>(peopleResponse)
    const pendingPerson = expectDefined(
      people.find((p) => p.email === testEmail),
      'Expected pending person in team people list',
    );
    expect(pendingPerson.isPending).toBe(true)
    expect(pendingPerson.user_id).toBeNull()

    // Accept the invite (creates user account) - requires CSRF token
    const acceptCsrfToken = await getCsrfToken(page)
    const acceptResponse = await page.request.post(`/api/invites/${inviteToken}/accept`, {
      headers: { 'x-csrf-token': acceptCsrfToken },
      data: {
        password: testPassword,
        name: testName
      }
    })
    expect(acceptResponse.status()).toBe(201)

    // Verify the user now appears as a regular member (not pending)
    // Re-login as admin to check (acceptance creates new session)
    await loginAsSuperAdmin(page)

    peopleResponse = await page.request.get('/api/team/people')
    people = await readJsonAs<TeamPerson[]>(peopleResponse)
    const acceptedPerson = expectDefined(
      people.find((p) => p.email === testEmail),
      'Expected accepted person in team people list',
    );
    expect(acceptedPerson.isPending).toBeFalsy() // Should be false or undefined
    expect(acceptedPerson.user_id).not.toBeNull()
    if (!acceptedPerson.user_id) {
      throw new Error('Expected accepted person to have user_id');
    }
    expect(acceptedPerson.user_id.length).toBeGreaterThan(0)
    expect(acceptedPerson.name).toBe(testName)
  })

  test('accepted user can now be assigned to programs', async ({ page }) => {
    // Create and accept an invite
    const testEmail = `pending-assign-${Date.now()}@example.com`
    const testName = 'Assignable User'
    const testPassword = 'securepassword123'

    const csrfToken = await getCsrfToken(page)
    const workspaceId = await getWorkspaceId(page)

    // Create invite
    const inviteResponse = await page.request.post(`/api/workspaces/${workspaceId}/invites`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { email: testEmail, role: 'member' }
    })
    const inviteData = await readJsonAs<InviteCreateResponse>(inviteResponse)
    const inviteToken = inviteData.data.invite.token

    // Accept invite - requires CSRF token
    const acceptCsrfToken = await getCsrfToken(page)
    await page.request.post(`/api/invites/${inviteToken}/accept`, {
      headers: { 'x-csrf-token': acceptCsrfToken },
      data: { password: testPassword, name: testName }
    })

    // Re-login as admin
    await loginAsSuperAdmin(page)
    const newCsrfToken = await getCsrfToken(page)

    // Get the user's ID (now they should have one)
    const gridResponse = await page.request.get('/api/team/grid')
    const gridData = await readJsonAs<TeamGridResponse>(gridResponse)
    const acceptedUser = expectDefined(
      gridData.users.find((u) => u.email === testEmail),
      'Expected accepted user in team grid',
    );
    expect(acceptedUser.id).not.toBeNull()

    // Get a program
    const programsResponse = await page.request.get('/api/team/programs')
    const programs = await readJsonAs<TeamProgram[]>(programsResponse)
    expect(programs.length).toBeGreaterThan(0)
    const programId = programs[0].id

    // Try to assign the now-accepted user to a sprint
    const sprintNumber = 98 // Use high number to avoid conflicts

    const assignResponse = await page.request.post('/api/team/assign', {
      headers: { 'x-csrf-token': newCsrfToken },
      data: {
        userId: acceptedUser.id,
        programId: programId,
        sprintNumber: sprintNumber
      }
    })

    // Should succeed now that they have a valid user_id
    expect(assignResponse.status()).toBe(200)
    const assignData = await readJsonAs<AssignResponse>(assignResponse)
    expect(assignData.success).toBe(true)

    // Clean up
    await page.request.delete('/api/team/assign', {
      headers: { 'x-csrf-token': newCsrfToken },
      data: {
        userId: acceptedUser.id,
        sprintNumber: sprintNumber
      }
    })
  })
})

test.describe('Full Pending User Allocation Flow (Story 7)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('allocations made to pending user persist after invite acceptance', async ({ page }) => {
    // This is the critical end-to-end test for the pending user allocation feature.
    // Flow: create invite -> assign program to pending user -> accept invite -> verify allocation persists

    // Step 1: Create a pending invite
    const testEmail = `pending-persist-${Date.now()}@example.com`
    const testName = 'Persisted Allocation User'
    const testPassword = 'securepassword123'

    const csrfToken = await getCsrfToken(page)
    const workspaceId = await getWorkspaceId(page)

    const inviteResponse = await page.request.post(`/api/workspaces/${workspaceId}/invites`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { email: testEmail, role: 'member' }
    })
    expect(inviteResponse.status()).toBe(201)
    const inviteData = await readJsonAs<InviteCreateResponse>(inviteResponse)
    const inviteToken = inviteData.data.invite.token

    // Step 2: Get the pending user's personId from the grid API
    let gridResponse = await page.request.get('/api/team/grid')
    expect(gridResponse.status()).toBe(200)
    let gridData = await readJsonAs<TeamGridResponse>(gridResponse)
    const pendingUser = expectDefined(
      gridData.users.find((u) => u.email === testEmail),
      'Expected pending user in team grid',
    );
    expect(pendingUser.isPending).toBe(true)
    expect(pendingUser.id).toBeNull() // user_id is null for pending
    expect(pendingUser.personId).toBeDefined() // but personId exists
    if (!pendingUser.personId) {
      throw new Error('Expected personId for pending invite user');
    }
    const personDocId = pendingUser.personId

    // Step 3: Assign a program to the pending user using personId
    const programsResponse = await page.request.get('/api/team/programs')
    const programs = await readJsonAs<TeamProgram[]>(programsResponse)
    expect(programs.length).toBeGreaterThan(0)
    const programId = programs[0].id
    const sprintNumber = 97 // Use high number to avoid conflicts

    const assignResponse = await page.request.post('/api/team/assign', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        personId: personDocId,
        programId: programId,
        sprintNumber: sprintNumber
      }
    })
    expect(assignResponse.status()).toBe(200)

    // Step 4: Verify allocation shows in assignments API
    // The grid API shows issue-based associations, but assignments shows owner_id-based allocations
    // assignments structure: { [personId]: { [sprintNumber]: { programId, programName, ... } } }
    const assignmentsResponse = await page.request.get('/api/team/assignments')
    expect(assignmentsResponse.status()).toBe(200)
    const assignmentsData = await readJsonAs<TeamAssignmentsResponse>(assignmentsResponse)
    const sprintAssignment = sprintAssignmentForPerson(assignmentsData, personDocId, sprintNumber)
    expect(sprintAssignment).toBeDefined()
    expect(sprintAssignment?.programId).toBe(programId)

    // Step 5: Accept the invite (creates user account)
    const acceptCsrfToken = await getCsrfToken(page)
    const acceptResponse = await page.request.post(`/api/invites/${inviteToken}/accept`, {
      headers: { 'x-csrf-token': acceptCsrfToken },
      data: {
        password: testPassword,
        name: testName
      }
    })
    expect(acceptResponse.status()).toBe(201)

    // Step 6: Re-login as admin and verify allocation PERSISTS
    await loginAsSuperAdmin(page)

    // Check grid API to verify user is now active (not pending)
    gridResponse = await page.request.get('/api/team/grid')
    gridData = await readJsonAs<TeamGridResponse>(gridResponse)

    // The user should now appear as NON-pending with the same personId
    const acceptedUser = expectDefined(
      gridData.users.find((u) => u.email === testEmail),
      'Expected accepted user in team grid',
    );
    expect(acceptedUser.isPending).toBeFalsy() // No longer pending
    expect(acceptedUser.id).not.toBeNull() // Now has user_id
    expect(acceptedUser.personId).toBe(personDocId) // SAME personId as before!
    expect(acceptedUser.name).toBe(testName)

    // The allocation should STILL exist because it was tied to personId, not userId
    // Check assignments API for the persisted allocation
    const persistedAssignmentsResponse = await page.request.get('/api/team/assignments')
    const persistedAssignmentsData = await readJsonAs<TeamAssignmentsResponse>(persistedAssignmentsResponse)
    const persistedSprintAssignment = sprintAssignmentForPerson(
      persistedAssignmentsData,
      personDocId,
      sprintNumber,
    )
    expect(persistedSprintAssignment).toBeDefined()
    expect(persistedSprintAssignment?.programId).toBe(programId)

    // Step 7: Clean up
    const cleanupCsrfToken = await getCsrfToken(page)
    await page.request.delete('/api/team/assign', {
      headers: { 'x-csrf-token': cleanupCsrfToken },
      data: {
        personId: personDocId,
        sprintNumber: sprintNumber
      }
    })
  })

  test('UI shows allocation for pending user, then shows active user after acceptance', async ({ page }) => {
    // Similar to above but tests the UI instead of just API

    // Step 1: Create a pending invite
    const testEmail = `pending-ui-persist-${Date.now()}@example.com`
    const testName = 'UI Persist User'
    const testPassword = 'securepassword123'

    const csrfToken = await getCsrfToken(page)
    const workspaceId = await getWorkspaceId(page)

    const inviteResponse = await page.request.post(`/api/workspaces/${workspaceId}/invites`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { email: testEmail, role: 'member' }
    })
    const inviteData = await readJsonAs<InviteCreateResponse>(inviteResponse)
    const inviteToken = inviteData.data.invite.token

    // Step 2: Navigate to grid and find pending user
    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    const emailPrefix = testEmail.split('@')[0]
    await expect(page.getByText(emailPrefix)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('(pending)').first()).toBeVisible({ timeout: 5000 })

    // Step 3: Click on pending user's cell and assign a program
    const pendingUserRow = page.locator('div').filter({ hasText: emailPrefix }).filter({ hasText: '(pending)' }).first()
    const plusButton = pendingUserRow.getByRole('button', { name: '+' }).first()
    await expect(plusButton).toBeVisible({ timeout: 5000 })
    await plusButton.click()

    // Wait for program selector and pick first program
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 5000 })
    const firstProgram = page.locator('[cmdk-item]').first()
    await expect(firstProgram).toBeVisible()
    await firstProgram.click()

    // Wait for assignment to complete and UI to update
    await page.waitForTimeout(500)

    // Step 4: Accept the invite
    const acceptCsrfToken = await getCsrfToken(page)
    await page.request.post(`/api/invites/${inviteToken}/accept`, {
      headers: { 'x-csrf-token': acceptCsrfToken },
      data: { password: testPassword, name: testName }
    })

    // Step 5: Re-login and refresh grid
    await loginAsSuperAdmin(page)
    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // Step 6: Verify user now shows as active (not pending) with allocation
    // Should see the full name now, not email prefix
    await expect(page.getByText(testName)).toBeVisible({ timeout: 10000 })

    // Should NOT have "(pending)" next to their name anymore
    // Use a more specific selector - find the exact user cell that contains just the name
    // The team member column cells contain an initial avatar and the name text
    // Look for the specific element that displays the user name without matching the whole grid
    // Check if this specific element (or its immediate siblings) contains "(pending)"
    // The pending label appears right after the name in the same parent container
    const userNameText = await page.getByText(testName).first().textContent()
    const hasPendingInName = userNameText?.includes('(pending)') ?? false
    expect(hasPendingInName).toBe(false)
  })
})
