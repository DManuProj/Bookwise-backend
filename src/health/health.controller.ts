import { Controller, Get } from '@nestjs/common';

// Public health check for uptime monitors (keeps the Render free-tier
// instance warm). No auth guard, no DB access — returns instantly.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
