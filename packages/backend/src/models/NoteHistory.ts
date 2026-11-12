/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiNote } from './Note.js';

/**
 * 42times: ノートを編集する前の本文と CW。編集のたびに 1 行足す。
 * id は編集した時点で作るので、id の日時がこの版が置き換えられた日時になる
 */
@Entity('note_history')
export class MiNoteHistory {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public note: MiNote | null;

	@Column('text', {
		nullable: true,
	})
	public text: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public cw: string | null;
}
