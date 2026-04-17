import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../generated/prisma/prisma.service.js';
import { OnboardingDto } from './onboarding.dto.js';
import { AuthenticatedUser } from '../common/types/index.js';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async completeOnboarding(user: AuthenticatedUser, data: OnboardingDto) {
    // We'll add the full logic next
    this.logger.log(`Processing onboarding for: ${user.email}`);

    // ── Guard: already onboarded?
    if (user.onboardingComplete)
      throw new BadRequestException('Onboarding already completed');

    // ── Guard: slug already taken?

    const existingOrg = await this.prisma.db.organisation.findUnique({
      where: { slug: data.slug },
    });

    if (existingOrg) throw new BadRequestException('This slug is alredy taken');

    // ── Transaction: create everything
    const result = await this.prisma.db.$transaction(async (tx) => {
      //creating organization
      const org = await tx.organisation.create({
        data: {
          name: data.businessName,
          slug: data.slug,
          phone: data.phone,
          description: data.description || null,
        },
      });

      this.logger.log(`Organisation created: ${org.name} (${org.slug})`);

      // Step 2: Link user to organisation + mark as complete

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          orgId: org.id,
          status: 'ACTIVE',
          onboardingComplete: true,
          profileComplete: true,
        },
      });

      this.logger.log(`User ${updatedUser.email} linked to org: ${org.slug}`);

      // Step 3: Create Working Hours
      await tx.workingHour.createMany({
        data: data.workingHours.map((hour) => ({
          day: hour.day,
          isOpen: hour.isOpen,
          openTime: hour.openTime,
          closeTime: hour.closeTime,
          orgId: org.id,
        })),
      });
      this.logger.log(`Working hours created for org: ${org.slug}`);

      // Step 4: Create Staff Invitations + User records
      const staffToInvite = data.staff.filter(
        (member) => member.email !== user.email,
      );

      if (staffToInvite.length > 0) {
        // Create invitations
        await tx.staffInvitation.createMany({
          data: staffToInvite.map((member) => ({
            name: `${member.firstName} ${member.lastName}`.trim(),
            email: member.email,
            role: member.role,
            token: crypto.randomUUID(),
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
            status: 'PENDING',
            orgId: org.id,
          })),
        });

        // Create User records (INACTIVE until they accept)
        for (const member of staffToInvite) {
          await tx.user.create({
            data: {
              clerkId: `pending_${crypto.randomUUID()}`,
              email: member.email,
              firstName: member.firstName,
              lastName: member.lastName,
              phone: member.phone,
              role: member.role,
              status: 'INACTIVE',
              profileComplete: false,
              onboardingComplete: true,
              orgId: org.id,
            },
          });
        }

        this.logger.log(
          `${staffToInvite.length} staff invitation(s) + user(s) created`,
        );
      }

      // Step 5: Create Services
      await tx.service.createMany({
        data: data.services.map((service) => ({
          name: service.name,
          description: service.description || null,
          durationMins: service.durationMins,
          price: service.price,
          buffer: service.buffer,
          orgId: org.id,
        })),
      });
      this.logger.log(
        `${data.services.length} service(s) created for org: ${org.slug}`,
      );

      return { org, updatedUser };
    });

    return {
      success: true,
      orgId: result.org.id,
      message: 'Organization onboarding succesfull',
    };
  }
}
