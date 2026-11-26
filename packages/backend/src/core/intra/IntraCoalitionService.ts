/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { findUserCoalition } from './intra-coalition.js';
import type { IntraBloc, IntraCoalition } from './intra-coalition.js';

type IntraConfig = NonNullable<Config['intra']>;

/** キャンパスの bloc を取得し直すまでの時間 (ミリ秒)。コアリションが変わることはほとんど無い */
const BLOCS_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * ユーザーが所属する 42 のコアリション (キャンパス・対象 cursus のもの) を求める
 */
@Injectable()
export class IntraCoalitionService {
	private logger: Logger;
	private blocsCache = new Map<number, { blocs: IntraBloc[]; fetchedAt: number }>();

	constructor(
		@Inject(DI.config)
		private config: Config,

		private intraApiService: IntraApiService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-coalition');
	}

	@bindThis
	private getIntraConfig(): IntraConfig {
		if (this.config.intra == null) {
			throw new Error('42 intra integration is not configured');
		}
		return this.config.intra;
	}

	/**
	 * ユーザーのコアリション。キャンパスが無いか、所属していなければ null。
	 * 42 API から取得できなければ例外を投げる (所属が分からないときにロールを外さないため)
	 */
	@bindThis
	public async getUserCoalition(intraId: number, campusId: number | null): Promise<IntraCoalition | null> {
		if (campusId == null) return null;
		const intra = this.getIntraConfig();

		const blocs = await this.getCampusBlocs(campusId);
		if (!blocs.some(b => b.campus_id === campusId && b.cursus_id === intra.cursusId)) return null;

		const coalitionUsers = await this.intraApiService.getCoalitionsUsers(intraId);
		if (coalitionUsers == null) return null;

		return findUserCoalition(blocs, campusId, intra.cursusId, coalitionUsers);
	}

	/**
	 * キャンパスの bloc。プロセスの中で BLOCS_CACHE_TTL の間覚えておき、取り直せなければ古いものを使う
	 */
	@bindThis
	private async getCampusBlocs(campusId: number): Promise<IntraBloc[]> {
		const cached = this.blocsCache.get(campusId);
		if (cached != null && Date.now() - cached.fetchedAt < BLOCS_CACHE_TTL) return cached.blocs;

		try {
			const blocs = await this.intraApiService.getCampusBlocs(campusId);
			this.blocsCache.set(campusId, { blocs, fetchedAt: Date.now() });
			return blocs;
		} catch (err) {
			if (cached == null) throw err;
			this.logger.warn(`Failed to fetch blocs of campus ${campusId}; using the cached blocs: ${err instanceof Error ? err.message : String(err)}`);
			return cached.blocs;
		}
	}
}
