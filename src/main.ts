// Must be first: entity column types are resolved from process.env at import
// time, before Nest's ConfigModule has a chance to run.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import { AppModule } from './app.module';
import { applyHttpHardening } from './security/http-hardening';

async function bootstrap() {
  // bodyParser: false so the limit below applies to the ONE parser that runs.
  // Registering a second json() afterwards would never see a parsed-once body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Headers, rate limiting, proxy trust, CORS — before any body is read.
  applyHttpHardening(app);

  // Collector route: raw bytes, not parsed JSON. Its HMAC signature covers the
  // exact bytes sent, so it is verified on the Buffer before anything reads a
  // field (SyncSecretGuard); the controller parses only afterwards. The limit
  // applies to the size AFTER gzip decompression, which bounds zip bombs.
  // Registered first: once it has read the body, the JSON parser skips it.
  app.use('/api/scraper/ingest', raw({ type: () => true, limit: '24mb' }));

  // Everything else is small JSON (sign-in, nothing else takes a body).
  app.useBodyParser('json', { limit: '64kb' });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
