/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';

/**
 * ノートに付けた 42 intra のレベル。投稿した時点の値を持つ (後でレベルが上がっても変わらない)
 */
@Entity('intra_level_note')
export class MiIntraLevelNote {
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

	/** レベル (整数部分) */
	@Column('integer')
	public level: number;
}
