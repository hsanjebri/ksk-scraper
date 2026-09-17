// Must be first: entity column types are resolved from process.env at import
// time, before Nest's ConfigModule has a chance to run.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser: false so the limit below applies to the ONE parser that runs.
  // Registering a second json() afterwards would never see a parsed-once body.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // The plant agent posts whole pages: the real results page is ~700 KB, about
  // 1 MB once base64-encoded, against Express's 100 KB default. Gzipped bodies
  // are inflated first, so this limit applies to the decompressed size.
  app.useBodyParser('json', { limit: '24mb' });

  app.enableCors({ origin: '*' });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
