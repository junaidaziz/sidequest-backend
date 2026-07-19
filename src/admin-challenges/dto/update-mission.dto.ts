import { PartialType } from '@nestjs/swagger';
import { CreateMissionDto } from './create-mission.dto';

/**
 * Body for `PATCH /admin/missions/:id`. Every content/authoring field from
 * `CreateMissionDto` becomes optional (partial update) while keeping the exact
 * same per-field validators — including the `crewTags`/`settingTags` vocab
 * constraint. Lifecycle fields (`status`, `isActive`, `featured`, approval
 * fields) are intentionally still absent: they are only ever changed through the
 * dedicated publish/unpublish/archive/feature actions, never a blanket edit.
 */
export class UpdateMissionDto extends PartialType(CreateMissionDto) {}
