/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: 42 にログインできない人 (ブラックホールなど) のために、管理者がアカウントを用意してパスキーの登録リンクを渡す

import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { dateTimeFormat } from '@/utility/intl-const.js';

/** 42 の API で確かめられなかったときの理由。管理者が手動で確かめれば、そのまま作れる */
function getUnverifiedReason(code: string): string | null {
	switch (code) {
		case 'INTRA_ERROR': return i18n.ts._intra.verifyIntraError;
		case 'NO_SUCH_INTRA_USER': return i18n.ts._intra.verifyNotFound;
		case 'NOT_ELIGIBLE': return i18n.ts._intra.verifyNotEligible;
		default: return null;
	}
}

function getErrorMessage(err: Misskey.api.APIError): string {
	switch (err.code) {
		case 'SUSPENDED': return i18n.ts._intra._errors.suspended;
		case 'USERNAME_TAKEN': return i18n.ts._intra.manualUsernameTaken;
		case 'ACCESS_DENIED': return i18n.ts._intra.cannotIssueForAdmin;
		default: return err.message;
	}
}

function showPasskeySetupLink(username: string, url: string, expiresAt: string): void {
	copyToClipboard(url);
	os.alert({
		type: 'success',
		title: i18n.ts._intra.passkeySetupLinkIssued,
		text: `${i18n.tsx._intra.passkeySetupLinkDescription({ username, date: dateTimeFormat.format(new Date(expiresAt)) })}\n\n${url}`,
	});
}

/**
 * 42 のログイン名を聞いて、その人のアカウントを用意し (無ければ作り)、パスキーの登録リンクを出す
 */
export async function createIntraAccount(): Promise<void> {
	const { canceled, result: login } = await os.inputText({
		title: i18n.ts._intra.createAccountFromIntra,
		text: i18n.ts._intra.createAccountFromIntraDescription,
		placeholder: i18n.ts._intra.intraLogin,
	});
	if (canceled || login == null || login.trim() === '') return;

	const create = (manuallyVerified: boolean) => os.promiseDialog(misskeyApi('admin/intra/create-account', {
		login: login.trim(),
		manuallyVerified,
	}), null, () => {});

	let res: Misskey.entities.AdminIntraCreateAccountResponse;
	try {
		res = await create(false);
	} catch (err) {
		const apiError = err as Misskey.api.APIError;
		const reason = getUnverifiedReason(apiError.code);
		if (reason == null) {
			os.alert({ type: 'error', text: getErrorMessage(apiError) });
			return;
		}

		const confirm = await os.confirm({
			type: 'warning',
			text: `${reason}\n\n${i18n.ts._intra.manualVerifyConfirm}`,
			okText: i18n.ts._intra.manualVerifyOk,
		});
		if (confirm.canceled) return;

		try {
			res = await create(true);
		} catch (err2) {
			os.alert({ type: 'error', text: getErrorMessage(err2 as Misskey.api.APIError) });
			return;
		}
	}

	showPasskeySetupLink(res.username, res.url, res.expiresAt);
}

/**
 * 既存のアカウントに、パスキーの登録リンクを出す
 */
export async function issueIntraPasskeySetup(user: { id: string; username: string; }): Promise<void> {
	const confirm = await os.confirm({
		type: 'warning',
		text: i18n.ts._intra.issuePasskeySetupConfirm,
	});
	if (confirm.canceled) return;

	let res: Misskey.entities.AdminIntraIssuePasskeySetupResponse;
	try {
		res = await os.promiseDialog(misskeyApi('admin/intra/issue-passkey-setup', { userId: user.id }), null, () => {});
	} catch (err) {
		os.alert({ type: 'error', text: getErrorMessage(err as Misskey.api.APIError) });
		return;
	}
	showPasskeySetupLink(user.username, res.url, res.expiresAt);
}
