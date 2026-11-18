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
 * ペア募集への参加希望と参加、作成者からの招待。作成者はこのテーブルに入らない
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

	/** pending: 参加希望、accepted: 承認された、rejected: 見送られた、withdrawn: 取り下げた、invited: 招待された、declined: 招待を断った */
	@Column('varchar', {
		length: 16,
	})
	public status: PairMemberStatus;

	/** やりたい課題の slug (募集の課題のうちの 1 つ以上。招待中は空) */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public wantedProjectSlugs: string[];

	/** status を最後に変えた日時 */
	@Column('timestamp with time zone')
	public updatedAt: Date;
}
