import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { ServicesModule } from './services/services.module.js';
import { StaffModule } from './staff/staff.module.js';
import { InvitationModule } from './invitations/invitations.module.js';
import { MeModule } from './me/me.module.js';
import { BookingModule } from './bookings/booking.module.js';
import { CustomerModule } from './customers/customer.module.js';
import { PublicBookingModule } from './public-booking/public-booking.module.js';
import { EmailModule } from './email/email.module.js';
import { LeaveModule } from './leave/leave.module.js';
import { VapiModule } from './AIBooking/vapi.module.js';
import { NotificationModule } from './notifications/notifications.module.js';
import { BillingModule } from './billing/billing.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    WebhooksModule,
    AuthModule,
    OnboardingModule,
    OrganisationModule,
    ServicesModule,
    StaffModule,
    InvitationModule,
    MeModule,
    BookingModule,
    CustomerModule,
    PublicBookingModule,
    EmailModule,
    LeaveModule,
    VapiModule,
    NotificationModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
