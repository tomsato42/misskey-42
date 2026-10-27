/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

/**
 * 42 intra の課題と、キャンパスごとの登録の条件のキャッシュ。
 * 42 API の project_sessions (キャンパス・cursus ごとのセッション) から作る
 */
@Entity('intra_project')
@Index(['campusId', 'slug'], { unique: true })
export class MiIntraProject {
	@PrimaryColumn(id())
	public id: string;

	/** intra の課題 ID */
	@Column('integer')
	public projectId: number;

	@Column('varchar', {
		length: 128,
	})
	public slug: string;

	@Column('varchar', {
		length: 256,
	})
	public name: string;

	/** intra のキャンパス ID */
	@Column('integer')
	public campusId: number;

	/** intra の cursus ID */
	@Column('integer')
	public cursusId: number;

	/** intra の project_session ID */
	@Column('integer')
	public sessionId: number;

	/** グループの人数の下限 (GroupSizeBetweenNAndM)。ルールが無ければ null */
	@Column('integer', {
		nullable: true,
	})
	public minGroupSize: number | null;

	/** グループの人数の上限 (GroupSizeBetweenNAndM)。ルールが無ければ null */
	@Column('integer', {
		nullable: true,
	})
	public maxGroupSize: number | null;

	/** すべて達成している必要があるクエストの slug (QuestsValidated, QuestAndQuestValidated) */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public requiredQuests: string[];

	/** 各グループのうち 1 つ以上を達成している必要があるクエストの slug (QuestOrQuestValidated) */
	@Column('jsonb', {
		default: [],
	})
	public requiredAnyQuests: string[][];

	/** 1 つでも達成していると登録できないクエストの slug (QuestsNotValidated) */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public forbiddenQuests: string[];

	/** 1 つでも進行中か達成済みだと登録できない課題の slug (NeitherOngoingOrValidated)。この課題自身を含むことがある */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public exclusiveProjects: string[];

	/** すべて達成している必要がある課題の slug (ProjectsValidated) */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public requiredProjects: string[];

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
