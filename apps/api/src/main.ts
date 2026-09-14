import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApp } from './create-app';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const configService = app.get(ConfigService);

  // Prefer the configured API_PORT; fall back to the platform-provided PORT
  // (used by most hosting providers) when it is not set.
  const port = configService.get<number>('API_PORT') ?? Number(process.env.PORT ?? 4732);
  await app.listen(port);

  new Logger('Bootstrap').log(`ProjectFlow API listening on http://localhost:${port}`);
}

void bootstrap();
