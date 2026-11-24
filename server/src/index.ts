import { buildApp } from './app';

const { app, ctx } = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'shutdown failed');
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: ctx.env.host, port: ctx.env.port });
  app.log.info(`GigaChat server ready on http://${ctx.env.host}:${ctx.env.port} (${ctx.env.nodeEnv}, push ${ctx.push.enabled ? 'on' : 'off'})`);
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
