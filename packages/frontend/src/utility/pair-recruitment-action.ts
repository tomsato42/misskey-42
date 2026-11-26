/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { getPairRecruitmentErrorText } from '@/utility/pair-recruitment.js';

type PairRecruitmentActionEndpoint =
	| 'pair-recruitments/apply'
	| 'pair-recruitments/withdraw'
	| 'pair-recruitments/close'
	| 'pair-recruitments/accept'
	| 'pair-recruitments/reject'
	| 'pair-recruitments/update'
	| 'pair-recruitments/decline'
	| 'pair-recruitments/cancel-invitation';

/**
 * ペア募集の操作 (参加希望・取り下げ・締め切り・承認・見送り・編集・招待への返事と取り消し) を待機ダイアログ付きで呼ぶ。
 * 成功したら更新後の募集を、失敗したらエラーを表示して null を返す
 */
export async function pairRecruitmentAction<E extends PairRecruitmentActionEndpoint>(
	endpoint: E,
	data: Misskey.Endpoints[E]['req'],
): Promise<Misskey.entities.PairRecruitmentDetailed | null> {
	try {
		return await os.promiseDialog(misskeyApi(endpoint, data) as Promise<Misskey.entities.PairRecruitmentDetailed>, null, (err) => {
			showPairRecruitmentError(err);
		});
	} catch {
		return null;
	}
}

/**
 * ペア募集の API のエラーを表示する。知らないエラーはメッセージをそのまま出す
 */
export function showPairRecruitmentError(err: unknown): void {
	const text = getPairRecruitmentErrorText(err);
	const fallback = err != null && typeof err === 'object' && 'message' in err && typeof err.message === 'string' ? err.message : undefined;
	os.alert({
		type: 'error',
		title: i18n.ts.somethingHappened,
		text: text ?? fallback,
	});
}
