/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: 42 intra の課題の結果 (点数) の共有。課題を選んで、結果のカードを付けた投稿フォームを開く

import { defineAsyncComponent } from 'vue';
import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

/** 読み上げ用の、課題の名前・点数・合否 */
export function getIntraProjectResultLabel(result: Pick<Misskey.entities.IntraProjectNote, 'projectName' | 'finalMark' | 'validated'>): string {
	return i18n.tsx._intraProjectResult.scoreLabel({
		project: result.projectName,
		score: result.finalMark,
		result: result.validated ? i18n.ts._intraProjectResult.passed : i18n.ts._intraProjectResult.failed,
	});
}

/**
 * 課題を選ぶダイアログを開く。選んだらその結果、閉じたら null を返す
 */
export function openIntraProjectResultPicker(): Promise<Misskey.entities.IntraProjectResult | null> {
	let selected: Misskey.entities.IntraProjectResult | null = null;
	return new Promise((resolve) => {
		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkIntraProjectResultPickerDialog.vue')), {}, {
			done: (result) => {
				selected = result;
			},
			closed: () => {
				resolve(selected);
				dispose();
			},
		});
	});
}

/**
 * 課題の結果を付けた投稿フォームを開く。結果の ID を渡せばその結果 (通知から)、渡さなければ課題を選んでもらう (ナビから)
 */
export async function shareIntraProjectResult(resultId?: string): Promise<void> {
	let result: Misskey.entities.IntraProjectResult | null;
	if (resultId != null) {
		let results: Misskey.entities.IntraProjectResult[];
		try {
			results = await misskeyApi('i/intra/project-results');
		} catch (err) {
			os.alert({ type: 'error', text: (err as Partial<Misskey.api.APIError>).message ?? String(err) });
			return;
		}
		result = results.find(r => r.id === resultId) ?? null;
		if (result == null) {
			os.alert({ type: 'error', text: i18n.ts._intraProjectResult._errors.noSuchResult });
			return;
		}
	} else {
		result = await openIntraProjectResultPicker();
		if (result == null) return;
	}
	await os.post({ initialIntraProjectResult: result });
}
