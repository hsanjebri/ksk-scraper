import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Public: liveness check for the hosting platform. Returns no data.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
