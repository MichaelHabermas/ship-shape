import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('Health endpoint', () => {
  const app = createApp()

  it('returns ok status', async () => {
    const response = await request(app).get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', plugforge: true })
    expect(response.headers['content-type']).toMatch(/json/)
  })
})
