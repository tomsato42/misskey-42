/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiRole } from './Role.js';

export const intraRoleKinds = ['level', 'campus', 'pool', 'cohort'] as const;
export type IntraRoleKind = typeof intraRoleKinds[number];

/**
 * 42 intra の情報から自動で付与するロールと、その付与条件の対応
 */
@Entity('intra_role')
@Index(['kind', 'key'], { unique: true })
export class MiIntraRole {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public roleId: MiRole['id'];

	@OneToOne(() => MiRole, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public role: MiRole | null;

	/**
	 * level: 42cursus のレベル (整数) ごとのロール
	 * campus: 主キャンパスごとのロール
	 * pool: ピシンの時期 (年月) ごとのロール
	 * cohort: 本科 (42cursus) への入学時期ごとのロール。同じピシンの人が 42cursus を始めた月 (intra_cohort) から決める
	 */
	@Column('varchar', {
		length: 16,
	})
	public kind: IntraRoleKind;

	/**
	 * kind が level ならレベルの整数 (例: '5')、campus なら intra のキャンパス ID (例: '26')、
	 * pool ならピシンの年月 (YYMM、例: '2408')、cohort なら入学時期 (YYMM、例: '2410')
	 */
	@Column('varchar', {
		length: 64,
	})
	public key: string;
}
