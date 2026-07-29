import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isBootstrapUser, RequestUser } from '../common/types/index.js';
import { UpdateMeDto } from './me.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(private readonly prisma: PrismaService) {}

  //GET - fetch me details

  // GET — return current user profile
  async getMe(user: RequestUser) {
    // Valid session but no DB row yet — report "needs onboarding" so the
    // frontend routes to the wizard instead of reading a 401 as signed-out.
    if (isBootstrapUser(user)) {
      return {
        id: null,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: null,
        photoUrl: user.photoUrl,
        role: 'OWNER',
        status: 'ACTIVE',
        staffActive: false,
        profileComplete: false,
        onboardingComplete: false,
        orgId: null,
        org: null,
      };
    }

    let org: object | null = null;
    if (user.org) {
      const {
        stripeCustomerId: _sc,
        stripeSubscriptionId: _ss,
        ...safeOrg
      } = user.org;
      org = safeOrg;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      photoUrl: user.photoUrl,
      role: user.role,
      status: user.status,
      staffActive: user.staffActive,
      profileComplete: user.profileComplete,
      onboardingComplete: user.onboardingComplete,
      orgId: user.orgId,
      org,
    };
  }

  //PUT upadte me info
  async updateMe(user: RequestUser, data: UpdateMeDto) {
    // No DB row to update yet — onboarding must create it first.
    if (isBootstrapUser(user)) {
      throw new ForbiddenException(
        'Complete onboarding before updating your profile',
      );
    }

    const updated = await this.prisma.db.user.update({
      where: { id: user.id },
      data: {
        ...data,
        profileComplete: true,
      },
    });

    this.logger.log(`Profile updated: ${updated.email}`);

    return updated;
  }
}
