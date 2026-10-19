/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import type { IntraProjectStatuses } from '@/core/intra/intra-project.js';

/**
 * 42 intra のユーザーの課題の状態と、達成したクエスト。
 * user_profile は頻繁に読まれてキャッシュされるため、大きくなりうるこの情報は別のテーブルに置く
 */
@Entity('intra_user_progress')
export class MiIntraUserProgress {
	@PrimaryColumn(id())
	public userId: MiUser['id'];

	@OneToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	/** 主キャンパスの intra のキャンパス ID。課題の条件はキャンパスごとに違うため、判定にはこのキャンパスの intra_project を使う */
	@Index()
	@Column('integer', {
		nullable: true,
	})
	public campusId: number | null;

	/** 課題の slug ごとの状態 (projects_users の status と validated?) */
	@Column('jsonb', {
		default: {},
	})
	public projectStatuses: IntraProjectStatuses;

	/** 達成したクエストの slug (quests_users のうち validated_at があるもの) */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public validatedQuests: string[];

	/** projectStatuses を最後に更新した日時 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public projectsSyncedAt: Date | null;

	/** validatedQuests を最後に更新した日時 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public questsSyncedAt: Date | null;

	/** intra_project_result を最後に更新した日時。null なら初回なので、見つかった結果を通知しない */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public resultsSyncedAt: Date | null;
}
