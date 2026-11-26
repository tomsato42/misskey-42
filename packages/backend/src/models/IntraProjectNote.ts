/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import type { IntraProjectResultMember } from '@/core/intra/intra-project-result.js';

/**
 * ノートに付けた 42 intra の課題の結果。投稿した時点の値を持つ (後で再挑戦しても変わらない)
 */
@Entity('intra_project_note')
export class MiIntraProjectNote {
	@PrimaryColumn(id())
	public noteId: MiNote['id'];

	@OneToOne(() => MiNote, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public note: MiNote | null;

	/** ノートの作成者 */
	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

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

	/** 評価で outstanding が付いた数。取得できなかったときは null */
	@Column('integer', {
		nullable: true,
	})
	public outstandingCount: number | null;

	/** チームのメンバー (投稿した人を含む) */
	@Column('jsonb', {
		default: [],
	})
	public members: IntraProjectResultMember[];

	/** 何回目の提出か。分からなければ null */
	@Column('integer', {
		nullable: true,
	})
	public attemptNumber: number | null;

	/** 投稿した時点の提出の数。分からなければ null */
	@Column('integer', {
		nullable: true,
	})
	public attemptCount: number | null;

	/** 提出の点数が付いた日時 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public markedAt: Date | null;

	/** 投稿した人の intra のログイン名 (intra のその人の課題のページに飛ぶため) */
	@Column('varchar', {
		length: 64, nullable: true,
	})
	public intraLogin: string | null;
}
