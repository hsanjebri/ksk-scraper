// Must be first: entity column types are resolved from process.env at import
// time, before Nest's ConfigModule has a chance to run.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
