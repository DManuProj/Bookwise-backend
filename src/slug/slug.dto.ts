import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SlugDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens (e.g. my-business)',
  })
  slug!: string;
}
