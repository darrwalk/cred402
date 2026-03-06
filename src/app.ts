import express from 'express';
import scoreRouter from './routes/score';
import profileRouter from './routes/profile';
import statusRouter from './routes/status';
import registerRouter from './routes/register';
import leaderboardRouter from './routes/leaderboard';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Trust proxy for IP-based rate limiting on fly.io
  app.set('trust proxy', true);

  // Routes
  app.use('/v1/score', scoreRouter);
  app.use('/v1/profile', profileRouter);
  app.use('/v1/status', statusRouter);
  app.use('/v1/register', registerRouter);
  app.use('/v1/leaderboard', leaderboardRouter);

  // Root redirect
  app.get('/', (_req, res) => {
    res.json({
      name: 'Cred402',
      version: '2.0.0',
      description: 'x402-native TrustScore API for ERC-8004 AI agents',
      docs: '/v1/status',
      endpoints: {
        score: 'GET /v1/score/:agent',
        profile: 'GET /v1/profile/:agent',
        leaderboard: 'GET /v1/leaderboard?limit=100&category=',
        status: 'GET /v1/status',
        register: 'POST /v1/register',
      },
    });
  });

  return app;
}
