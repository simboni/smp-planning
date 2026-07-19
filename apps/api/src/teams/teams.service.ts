import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

/** A named group of workspace users, used for bulk sharing and @mentions. */
export interface Team {
  id: string;
  name: string;
  color: string;
}

export interface TeamListEntry extends Team {
  memberCount: number;
}

export interface TeamMember {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_TEAM_COLOR = "#7B68EE";

@Injectable()
export class TeamsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private toTeam(r: Record<string, unknown>): Team {
    return {
      id: r.id as string,
      name: r.name as string,
      color: r.color as string,
    };
  }

  private requireName(name: unknown): string {
    if (typeof name !== "string" || !name.trim()) {
      throw new BadRequestException("name is required");
    }
    return name.trim();
  }

  private validColor(color: unknown): string {
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      throw new BadRequestException("color must be a hex color like #7B68EE");
    }
    return color;
  }

  /** Assert a user is an active-or-pending member of the current workspace. */
  private async assertWorkspaceMember(
    client: PoolClient,
    userId: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM memberships WHERE user_id = $1`,
      [userId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException("user is not a member of this workspace");
    }
  }

  // --- Reads ----------------------------------------------------------------

  async list(workspaceId: string, userId: string): Promise<TeamListEntry[]> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `SELECT t.id, t.name, t.color, COUNT(tm.id)::int AS member_count
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id
         GROUP BY t.id
         ORDER BY t.created_at`,
      );
      return res.rows.map((r) => ({
        ...this.toTeam(r),
        memberCount: r.member_count as number,
      }));
    });
  }

  async detail(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<{ team: Team; members: TeamMember[] }> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const teamRes = await client.query(
        `SELECT id, name, color FROM teams WHERE id = $1`,
        [id],
      );
      if (!teamRes.rows[0]) throw new NotFoundException("Team not found");
      const membersRes = await client.query(
        `SELECT u.id, u.full_name, u.email, u.avatar_url
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = $1
         ORDER BY tm.created_at`,
        [id],
      );
      return {
        team: this.toTeam(teamRes.rows[0]),
        members: membersRes.rows.map((r) => ({
          userId: r.id as string,
          fullName: r.full_name as string,
          email: r.email as string,
          avatarUrl: (r.avatar_url as string | null) ?? null,
        })),
      };
    });
  }

  // --- Writes (admin) -------------------------------------------------------

  async create(
    workspaceId: string,
    userId: string,
    body: { name?: string; color?: string; memberUserIds?: string[] },
  ): Promise<Team> {
    const name = this.requireName(body?.name);
    const color =
      body?.color === undefined || body.color === null
        ? DEFAULT_TEAM_COLOR
        : this.validColor(body.color);
    const memberIds = body?.memberUserIds ?? [];
    if (
      !Array.isArray(memberIds) ||
      memberIds.some((x) => typeof x !== "string")
    ) {
      throw new BadRequestException("memberUserIds must be an array of strings");
    }

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      for (const memberId of memberIds) {
        await this.assertWorkspaceMember(client, memberId);
      }
      const res = await client.query(
        `INSERT INTO teams (workspace_id, name, color, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, color`,
        [workspaceId, name, color, userId],
      );
      const team = this.toTeam(res.rows[0]);
      for (const memberId of memberIds) {
        await client.query(
          `INSERT INTO team_members (workspace_id, team_id, user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (team_id, user_id) DO NOTHING`,
          [workspaceId, team.id, memberId],
        );
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "team.created",
        entity: "team",
        entityId: team.id,
        data: { name: team.name, memberUserIds: memberIds },
      });
      return team;
    });
  }

  async update(
    workspaceId: string,
    userId: string,
    id: string,
    body: { name?: string; color?: string },
  ): Promise<Team> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (body?.name !== undefined) {
      sets.push(`name = $${i++}`);
      params.push(this.requireName(body.name));
    }
    if (body?.color !== undefined) {
      sets.push(`color = $${i++}`);
      params.push(this.validColor(body.color));
    }

    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      let team: Team;
      if (sets.length === 0) {
        const res = await client.query(
          `SELECT id, name, color FROM teams WHERE id = $1`,
          [id],
        );
        if (!res.rows[0]) throw new NotFoundException("Team not found");
        team = this.toTeam(res.rows[0]);
      } else {
        params.push(id);
        const res = await client.query(
          `UPDATE teams SET ${sets.join(", ")} WHERE id = $${i}
           RETURNING id, name, color`,
          params,
        );
        if (!res.rows[0]) throw new NotFoundException("Team not found");
        team = this.toTeam(res.rows[0]);
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "team.updated",
        entity: "team",
        entityId: team.id,
        data: { ...body },
      });
      return team;
    });
  }

  async remove(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      // team_members cascade via FK; shares to this team are NOT FK-linked to
      // teams, so clean them up explicitly to avoid dangling grants.
      await client.query(
        `DELETE FROM shares WHERE principal_type = 'team' AND principal_id = $1`,
        [id],
      );
      const res = await client.query(
        `DELETE FROM teams WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException("Team not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "team.deleted",
        entity: "team",
        entityId: id,
      });
    });
  }

  async addMember(
    workspaceId: string,
    userId: string,
    teamId: string,
    memberUserId: string,
  ): Promise<void> {
    if (typeof memberUserId !== "string" || !memberUserId) {
      throw new BadRequestException("userId is required");
    }
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const team = await client.query(`SELECT id FROM teams WHERE id = $1`, [
        teamId,
      ]);
      if (!team.rows[0]) throw new NotFoundException("Team not found");
      await this.assertWorkspaceMember(client, memberUserId);
      const insert = await client.query(
        `INSERT INTO team_members (workspace_id, team_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (team_id, user_id) DO NOTHING
         RETURNING id`,
        [workspaceId, teamId, memberUserId],
      );
      if (!insert.rows[0]) {
        throw new ConflictException("Already a member of this team");
      }
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "team.member_added",
        entity: "team",
        entityId: teamId,
        data: { userId: memberUserId },
      });
    });
  }

  async removeMember(
    workspaceId: string,
    userId: string,
    teamId: string,
    memberUserId: string,
  ): Promise<void> {
    return this.db.withWorkspace(workspaceId, userId, async (client) => {
      const res = await client.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2
         RETURNING id`,
        [teamId, memberUserId],
      );
      if (!res.rows[0]) throw new NotFoundException("Team membership not found");
      await this.audit.record(client, {
        workspaceId,
        actorUserId: userId,
        action: "team.member_removed",
        entity: "team",
        entityId: teamId,
        data: { userId: memberUserId },
      });
    });
  }
}
