/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiCalendarEvent } from './CalendarEvent.js';

/**
 * ノートとカレンダーのイベントの紐づけ。1つのノートは1つのイベントにだけ紐づく
 */
@Entity('calendar_event_note')
export class MiCalendarEventNote {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public eventId: MiCalendarEvent['id'];

	@ManyToOne(() => MiCalendarEvent, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public event: MiCalendarEvent | null;

	@Column(id())
	public noteId: MiNote['id'];

	@OneToOne(() => MiNote, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public note: MiNote | null;

	/**
	 * ノートの作成者 (紐づけた人)
	 */
	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;
}
