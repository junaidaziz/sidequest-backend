import { PartialType } from '@nestjs/swagger';
import { CreateCampaignDto } from './create-campaign.dto';

/**
 * Body for `PATCH /admin/campaigns/:id` — every field optional. Editing is only
 * permitted while the campaign is still a `Draft`; that rule is enforced in the
 * service (a 409 once it has started sending), NOT in this DTO, so the shape stays
 * a plain partial of the create body.
 */
export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}
