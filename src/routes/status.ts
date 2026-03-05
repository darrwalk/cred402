import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    version: '1.0.0',
    service: 'cred402',
    timestamp: new Date().toISOString(),
  });
});

export default router;
