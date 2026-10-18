/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiPairRecruitment } from './PairRecruitment.js';
import type { PairMemberStatus } from '@/core/pair/pair-recruitment.js';

/**
 * ペア募集への参加希望と参加。作成者はこのテーブルに入らない
 */
@Entity('pair_member')
@Index(['recruitmentId', 'userId'], { unique: true })
export class MiPairMember {
	@PrimaryColumn(id())
	public id: string;

	@Column({
		...id(),
	})
	public recruitmentId: MiPairRecruitment['id'];

	@ManyToOne(() => MiPairRecruitment, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public recruitment: MiPairRecruitment | null;

	@Index()
	@Column({
		...id(),
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	/** pending: 参加希望、accepted: 承認された、rejected: 見送られた、withdrawn: 本人が取り下げた */
	@Column('varchar', {
		length: 16,
	})
	public status: PairMemberStatus;

	/** status を最後に変えた日時 */
	@Column('timestamp with time zone')
	public updatedAt: Date;
}
