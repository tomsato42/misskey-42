<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker markerId="2fa" :keywords="['2fa']">
	<FormSection :first="first">
		<template #label><SearchLabel>{{ i18n.ts['2fa'] }}</SearchLabel></template>

		<div v-if="$i" class="_gaps_s">
			<MkInfo v-if="$i.twoFactorEnabled && $i.twoFactorBackupCodesStock === 'partial'" warn>
				{{ i18n.ts._2fa.backupCodeUsedWarning }}
			</MkInfo>
			<MkInfo v-if="$i.twoFactorEnabled && $i.twoFactorBackupCodesStock === 'none'" warn>
				{{ i18n.ts._2fa.backupCodesExhaustedWarning }}
			</MkInfo>

			<SearchMarker v-if="!usesIntraReauth" :keywords="['totp', 'app']">
				<MkFolder :defaultOpen="true">
					<template #icon><i class="ti ti-shield-lock"></i></template>
					<template #label><SearchLabel>{{ i18n.ts.totp }}</SearchLabel></template>
					<template #caption><SearchText>{{ i18n.ts.totpDescription }}</SearchText></template>
					<template #suffix><i v-if="$i.twoFactorEnabled" class="ti ti-check" style="color: var(--MI_THEME-success)"></i></template>

					<div v-if="$i.twoFactorEnabled" class="_gaps_s">
						<div>{{ i18n.ts._2fa.alreadyRegistered }}</div>
						<template v-if="$i.securityKeysList!.length > 0">
							<MkButton @click="renewTOTP">{{ i18n.ts._2fa.renewTOTP }}</MkButton>
							<MkInfo>{{ i18n.ts._2fa.whyTOTPOnlyRenew }}</MkInfo>
						</template>
						<MkButton v-else danger @click="unregisterTOTP">{{ i18n.ts.unregister }}</MkButton>
					</div>

					<div v-else-if="!$i.twoFactorEnabled" class="_gaps_s">
						<MkButton primary gradate @click="registerTOTP">{{ i18n.ts._2fa.registerTOTP }}</MkButton>
						<MkLink url="https://misskey-hub.net/docs/for-users/stepped-guides/how-to-enable-2fa/" target="_blank"><i class="ti ti-help-circle"></i> {{ i18n.ts.learnMore }}</MkLink>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['security', 'key', 'passkey']">
				<MkFolder :defaultOpen="usesIntraReauth">
					<template #icon><i class="ti ti-key"></i></template>
					<template #label><SearchLabel>{{ i18n.ts.securityKeyAndPasskey }}</SearchLabel></template>
					<template v-if="usesIntraReauth" #suffix><i v-if="$i.securityKeysList!.length > 0" class="ti ti-check" style="color: var(--MI_THEME-success)"></i></template>
					<div class="_gaps_s">
						<MkInfo v-if="usesIntraReauth">
							{{ i18n.ts._intra.passkeyInfo }}
						</MkInfo>
						<MkInfo v-else>
							{{ i18n.ts._2fa.securityKeyInfo }}
						</MkInfo>

						<MkInfo v-if="!browserSupportsWebAuthn()" warn>
							{{ i18n.ts._2fa.securityKeyNotSupported }}
						</MkInfo>

						<MkInfo v-else-if="browserSupportsWebAuthn() && !$i.twoFactorEnabled && !usesIntraReauth" warn>
							{{ i18n.ts._2fa.registerTOTPBeforeKey }}
						</MkInfo>

						<template v-else>
							<MkButton primary @click="addSecurityKey">{{ i18n.ts._2fa.registerSecurityKey }}</MkButton>
							<MkFolder v-for="key in $i.securityKeysList!" :key="key.id">
								<template #label>{{ key.name }}</template>
								<template #suffix><I18n :src="i18n.ts.lastUsedAt"><template #t><MkTime :time="key.lastUsed"/></template></I18n></template>
								<div class="_buttons">
									<MkButton @click="renameKey(key)"><i class="ti ti-forms"></i> {{ i18n.ts.rename }}</MkButton>
									<MkButton danger @click="unregisterKey(key)"><i class="ti ti-trash"></i> {{ i18n.ts.unregister }}</MkButton>
								</div>
							</MkFolder>
						</template>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker v-if="!usesIntraReauth" :keywords="['password', 'less', 'key', 'passkey', 'login', 'signin']">
				<MkSwitch :disabled="!$i.twoFactorEnabled || $i.securityKeysList!.length === 0" :modelValue="usePasswordLessLogin" @update:modelValue="v => updatePasswordLessLogin(v)">
					<template #label><SearchLabel>{{ i18n.ts.passwordLessLogin }}</SearchLabel></template>
					<template #caption><SearchText>{{ i18n.ts.passwordLessLoginDescription }}</SearchText></template>
				</MkSwitch>
			</SearchMarker>
		</div>
	</FormSection>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, onMounted } from 'vue';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import FormSection from '@/components/form/section.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkLink from '@/components/MkLink.vue';
import * as os from '@/os.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { updateCurrentAccount } from '@/accounts.js';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { startIntraReauth } from '@/utility/intra-login.js';

const $i = ensureSignin();

// メモ: 各エンドポイントはmeUpdatedを発行するため、refreshAccountは不要

withDefaults(defineProps<{
	first?: boolean;
}>(), {
	first: false,
});

const usePasswordLessLogin = computed(() => $i.usePasswordLessLogin ?? false);

// 42times: intra で作ったアカウントはパスワードを持たないので、パスキーの登録・削除ではパスワードの代わりに 42 でログインし直して本人確認をする。
// TOTP は登録できない (パスワードが要る) ので出さず、パスキーは登録すると backend がパスワードレスログインを有効にする
const usesIntraReauth = instance.intraLoginEnabled === true && $i.intra != null;

type KeyEndpoint = 'i/2fa/register-key' | 'i/2fa/key-done' | 'i/2fa/remove-key';

/**
 * パスキーの登録・削除の前の確認。intra で作ったアカウントなら何も聞かない (backend が本人確認の済みを確かめる)。キャンセルされたら null
 */
async function authenticateForKey(): Promise<Pick<Misskey.entities.I2faRegisterKeyRequest, 'password' | 'token'> | null> {
	if (usesIntraReauth) return {};

	const auth = await os.authenticateDialog();
	if (auth.canceled) return null;
	return { password: auth.result.password, token: auth.result.token };
}

/**
 * パスキーの API を呼ぶ。intra で作ったアカウントで本人確認が済んでいなければ、42 でのログインし直しに案内して null を返す
 */
async function callKeyApi<E extends KeyEndpoint>(endpoint: E, data: Misskey.Endpoints[E]['req']): Promise<Misskey.Endpoints[E]['res'] | null> {
	if (!usesIntraReauth) return await os.apiWithDialog(endpoint, data) as Misskey.Endpoints[E]['res'];

	try {
		return await os.promiseDialog(misskeyApi(endpoint, data), null, () => {}) as Misskey.Endpoints[E]['res'];
	} catch (err) {
		if ((err as Misskey.api.APIError).code === 'INTRA_REAUTH_REQUIRED') {
			await requestIntraReauth(endpoint === 'i/2fa/remove-key' ? 'remove' : 'register');
		} else {
			os.alert({ type: 'error', text: (err as Misskey.api.APIError).message });
		}
		return null;
	}
}

// 本人確認から戻ってきたときに、登録を続けるかを決めるために、始めた操作を覚えておく
const INTRA_REAUTH_ACTION_KEY = 'intraReauthAction';

async function requestIntraReauth(action: 'register' | 'remove'): Promise<void> {
	const { canceled } = await os.confirm({
		type: 'info',
		text: i18n.ts._intra.reauthRequired,
	});
	if (canceled) return;

	try {
		window.sessionStorage.setItem(INTRA_REAUTH_ACTION_KEY, action);
	} catch {
		// 保存できなくても、戻ってきたときに操作をやり直してもらうだけ
	}
	await os.promiseDialog(startIntraReauth(), null, (err) => {
		os.alert({ type: 'error', text: err.message });
	});
}

function popIntraReauthAction(): string | null {
	try {
		const action = window.sessionStorage.getItem(INTRA_REAUTH_ACTION_KEY);
		window.sessionStorage.removeItem(INTRA_REAUTH_ACTION_KEY);
		return action;
	} catch {
		return null;
	}
}

// 本人確認から戻ってきたときは、クエリの intraReauth に結果が入っている
onMounted(() => {
	if (!usesIntraReauth) return;

	const params = new URLSearchParams(window.location.search);
	const result = params.get('intraReauth');
	if (result == null) return;

	// 再読み込みのたびに出ないようにクエリを消す。router.replace だとページが作り直されるので、履歴を直接書き換える
	params.delete('intraReauth');
	const query = params.toString();
	window.history.replaceState(window.history.state, '', `${window.location.pathname}${query === '' ? '' : `?${query}`}${window.location.hash}`);

	showIntraReauthResult(result);
});

async function showIntraReauthResult(result: string): Promise<void> {
	const action = popIntraReauthAction();
	if (result === 'ok' && action === 'register') {
		const { canceled } = await os.confirm({
			type: 'success',
			text: i18n.ts._intra.reauthDone,
		});
		if (!canceled) addSecurityKey();
	} else if (result === 'ok') {
		os.alert({ type: 'success', text: i18n.ts._intra.reauthDoneRetry });
	} else if (result === 'mismatch') {
		os.alert({ type: 'error', text: i18n.ts._intra.reauthMismatch });
	} else {
		os.alert({ type: 'error', text: i18n.ts._intra.reauthFailed });
	}
}

async function registerTOTP(): Promise<void> {
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	const twoFactorData = await os.apiWithDialog('i/2fa/register', {
		password: auth.result.password,
		token: auth.result.token,
	});

	const { dispose } = await os.popupAsyncWithDialog(import('./2fa.qrdialog.vue').then(x => x.default), {
		twoFactorData,
	}, {
		closed: () => dispose(),
	});
}

async function unregisterTOTP(): Promise<void> {
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	os.apiWithDialog('i/2fa/unregister', {
		password: auth.result.password,
		token: auth.result.token,
	}).then(res => {
		updateCurrentAccount({
			twoFactorEnabled: false,
		});
	}).catch(error => {
		os.alert({
			type: 'error',
			text: error,
		});
	});
}

function renewTOTP(): void {
	os.confirm({
		type: 'question',
		title: i18n.ts._2fa.renewTOTP,
		text: i18n.ts._2fa.renewTOTPConfirm,
		okText: i18n.ts._2fa.renewTOTPOk,
		cancelText: i18n.ts._2fa.renewTOTPCancel,
	}).then(({ canceled }) => {
		if (canceled) return;
		registerTOTP();
	});
}

async function unregisterKey(key: NonNullable<Misskey.entities.MeDetailedOnly['securityKeysList']>[number]) {
	const confirm = await os.confirm({
		type: 'question',
		title: i18n.ts._2fa.removeKey,
		text: i18n.tsx._2fa.removeKeyConfirm({ name: key.name }),
	});
	if (confirm.canceled) return;

	const auth = await authenticateForKey();
	if (auth == null) return;

	const res = await callKeyApi('i/2fa/remove-key', {
		...auth,
		credentialId: key.id,
	});
	if (res == null) return;
	os.success();
}

async function renameKey(key: NonNullable<Misskey.entities.MeDetailedOnly['securityKeysList']>[number]) {
	const name = await os.inputText({
		title: i18n.ts.rename,
		default: key.name,
		type: 'text',
		minLength: 1,
		maxLength: 30,
	});
	if (name.canceled) return;

	await os.apiWithDialog('i/2fa/update-key', {
		name: name.result,
		credentialId: key.id,
	});
}

async function addSecurityKey() {
	const auth = await authenticateForKey();
	if (auth == null) return;

	const registrationOptions = await callKeyApi('i/2fa/register-key', auth);
	if (registrationOptions == null) return;

	const name = await os.inputText({
		title: i18n.ts._2fa.registerSecurityKey,
		text: i18n.ts._2fa.securityKeyName,
		type: 'text',
		minLength: 1,
		maxLength: 30,
	});
	if (name.canceled) return;

	const credential = await os.promiseDialog(
		startRegistration({ optionsJSON: registrationOptions }),
		null,
		() => {}, // ユーザーのキャンセルはrejectなのでエラーダイアログを出さない
		i18n.ts._2fa.tapSecurityKey,
	);
	if (!credential) return;

	const auth2 = await authenticateForKey();
	if (auth2 == null) return;

	await callKeyApi('i/2fa/key-done', {
		...auth2,
		name: name.result,
		credential: credential,
	});
}

async function updatePasswordLessLogin(value: boolean) {
	await os.apiWithDialog('i/2fa/password-less', {
		value,
	});
}
</script>
