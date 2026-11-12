/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

/**
 * キャンパス・ピシンごとの本科 (42cursus) への入学時期。
 * 42 API のキャンパスの 42cursus の在籍者から集計する (intra-cohort.ts の buildCohortTable)
 */
@Entity('intra_cohort')
@Index(['campusId', 'poolYearMonth'], { unique: true })
export class MiIntraCohort {
	@PrimaryColumn(id())
	public id: string;

	/** intra のキャンパス ID */
	@Column('integer')
	public campusId: number;

	/** intra の名称 (pool_year / pool_month) のピシンの年月 (YYMM) */
	@Column('varchar', {
		length: 4,
	})
	public poolYearMonth: string;

	/** 入学時期 (YYMM) */
	@Column('varchar', {
		length: 4,
	})
	public cohortYearMonth: string;

	/** 入学時期に 42cursus を始めた人数 */
	@Column('integer')
	public userCount: number;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
