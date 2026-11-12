/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import type { CalendarEventNotesRepository, NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { ApiError } from '@/server/api/error.js';
import { calendarModeratorViewParam } from '@/server/api/calendar-api.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['calendar', 'notes'],

	requireCredential: true,

	kind: 'read:account',

	description: 'List notes of a calendar event, newest first: notes linked to the event, notes with the event\'s hashtag, and direct replies to either of them. Notes the viewer cannot see (visibility, blocking, muting) are excluded.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: 'd1599890-b83e-4e1a-b92e-9c232a38921d',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		moderatorView: calendarModeratorViewParam,
	},
	required: ['eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.calendarEventNotesRepository)
		private calendarEventNotesRepository: CalendarEventNotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private calendarEventService: CalendarEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const event = await this.calendarEventService.findById(ps.eventId);
			if (event == null || !await this.calendarEventService.canView(event, me, { moderatorView: ps.moderatorView })) throw new ApiError(meta.errors.noSuchEvent);

			// イベントのノートは、紐づけたノート・イベントのハッシュタグが付いたノートと、そのどちらかへの直接のリプライ
			const linkedNoteIds = this.calendarEventNotesRepository.createQueryBuilder('calendarEventNote')
				.select('calendarEventNote.noteId')
				.where('calendarEventNote.eventId = :eventId');
			const taggedNoteIds = this.notesRepository.createQueryBuilder('taggedNote')
				.select('taggedNote.id')
				.where(':eventTag <@ taggedNote.tags');

			// 紐づけの表やタグは公開範囲を見ていないので、タイムラインと同じ条件で閲覧者が見てよいノートに絞る (notes/search-by-tag と同じ)
			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId)
				.andWhere(new Brackets(qb => {
					qb.where(`note.id IN (${linkedNoteIds.getQuery()})`)
						.orWhere(`note.replyId IN (${linkedNoteIds.getQuery()})`);
					// ハッシュタグは保存するときに normalizeForSearch 済みで、note.tags と同じ形
					if (event.hashtag != null) {
						qb.orWhere(':eventTag <@ note.tags', { eventTag: [event.hashtag] })
							.orWhere(`note.replyId IN (${taggedNoteIds.getQuery()})`);
					}
				}))
				.setParameter('eventId', event.id)
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			this.queryService.generateVisibilityQuery(query, me);
			this.queryService.generateBaseNoteFilteringQuery(query, me);

			const notes = await query.limit(ps.limit).getMany();

			return await this.noteEntityService.packMany(notes, me);
		});
	}
}
