import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import request from 'supertest';

describe('Health Check', () => {
  const app = createApp();

  it('GET /v1/status returns ok', async () => {
    const res = await request(app).get('/v1/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.service).toBe('cred402');
  });

  it('GET / returns API info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Cred402');
    expect(res.body.endpoints).toBeDefined();
  });

  it('validates Ethereum address format', () => {
    const { isAddress } = require('viem');
    expect(isAddress('not-an-address')).toBe(false);
    expect(isAddress('0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F')).toBe(true);
    expect(isAddress('0xinvalid')).toBe(false);
  });
});
