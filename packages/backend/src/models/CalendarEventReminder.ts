/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiCalendarEvent } from './CalendarEvent.js';

export const calendarEventReminderKinds = ['week', 'day', 'today'] as const;
export type CalendarEventReminderKind = typeof calendarEventReminderKinds[number];

/**
 * 購読者に送ったイベントのリマインダーの記録 (同じ通知を二度送らないため)。
 * イベントの日時が変わったら消して、送り直せるようにする
 */
@Entity('calendar_event_reminder')
@Index(['eventId', 'userId', 'kind'], { unique: true })
export class MiCalendarEventReminder {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public eventId: MiCalendarEvent['id'];

	@ManyToOne(() => MiCalendarEvent, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public event: MiCalendarEvent | null;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	/**
	 * week: 1週間前、day: 前日、today: 当日
	 */
	@Column('varchar', {
		length: 16,
	})
	public kind: CalendarEventReminderKind;
}
