/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import type { IntraProjectResultMember, IntraProjectSubmission } from '@/core/intra/intra-project-result.js';

/**
 * 42 intra のユーザーの課題の結果 (点数が付いた projects_users)。合否は問わない。
 * チームのメンバーと outstanding の数は 42 API への問い合わせが別に要るので、必要になったときに取得して持つ
 */
@Entity('intra_project_result')
@Index(['userId', 'projectsUserId'], { unique: true })
export class MiIntraProjectResult {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	/** intra の projects_users の ID */
	@Column('integer')
	public projectsUserId: number;

	@Column('varchar', {
		length: 128,
	})
	public projectSlug: string;

	@Column('varchar', {
		length: 256,
	})
	public projectName: string;

	@Column('integer')
	public finalMark: number;

	@Column('boolean')
	public validated: boolean;

	/** 点数が付いた日時 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public markedAt: Date | null;

	/** 最後に組んだチームの intra の ID */
	@Column('integer', {
		nullable: true,
	})
	public teamId: number | null;

	/** チームのメンバー。detailsTeamId のチームのもの */
	@Column('jsonb', {
		default: [],
	})
	public members: IntraProjectResultMember[];

	/** 評価で outstanding が付いた数。まだ取得していなければ null */
	@Column('integer', {
		nullable: true,
	})
	public outstandingCount: number | null;

	/** members と outstandingCount を取得したチームの ID。teamId と違えば取得し直す */
	@Column('integer', {
		nullable: true,
	})
	public detailsTeamId: number | null;

	/** 提出 (チーム) ごとの結果。古い順。submissionsTeamId が teamId と違えば取得し直す */
	@Column('jsonb', {
		default: [],
	})
	public submissions: IntraProjectSubmission[];

	/** submissions を取得したときの最後のチームの ID */
	@Column('integer', {
		nullable: true,
	})
	public submissionsTeamId: number | null;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
