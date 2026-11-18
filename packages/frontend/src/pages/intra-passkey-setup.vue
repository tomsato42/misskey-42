<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithAnimBg>
	<div :class="$style.formContainer">
		<div :class="$style.form" class="_panel">
			<div :class="[$style.banner, { [$style.bannerError]: errorMessage != null }]">
				<i v-if="errorMessage != null" class="ti ti-alert-triangle"></i>
				<i v-else class="ti ti-key"></i>
			</div>
			<div class="_gaps_m" :class="$style.body">
				<div v-if="errorMessage != null" role="alert">{{ errorMessage }}</div>
				<div v-else-if="username == null" role="status" :class="$style.processing">{{ i18n.ts.loading }}<MkEllipsis/></div>
				<template v-else>
					<div style="font-size: 120%; font-weight: bold;">{{ i18n.ts._intra.passkeySetupTitle }}</div>
					<div>{{ i18n.tsx._intra.passkeySetupFor({ username }) }}</div>
					<div>{{ i18n.ts._intra.passkeySetupDescription }}</div>
					<MkInfo v-if="!browserSupportsWebAuthn()" warn>{{ i18n.ts._2fa.securityKeyNotSupported }}</MkInfo>
					<div v-else>
						<MkButton gradate large rounded style="margin: 0 auto;" :disabled="processing" data-testid="intra-passkey-setup" @click="createPasskey">
							<i class="ti ti-key"></i> {{ i18n.ts._intra.createPasskey }}
						</MkButton>
					</div>
				</template>
			</div>
		</div>
	</div>
</PageWithAnimBg>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';
import * as os from '@/os.js';
import { beginIntraPasskeySetup, completeIntraPasskeySetup, IntraPasskeySetupError } from '@/utility/intra-login.js';
import { getPasskeyRegistrationErrorMessage } from '@/utility/passkey-registration-error.js';

const props = defineProps<{
	token: string;
}>();

// backend が登録の challenge を覚えている時間 (5 分) より少し短くする
const OPTIONS_MAX_AGE_MS = 1000 * 60 * 4;

const username = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const processing = ref(false);

// 登録の準備 (challenge) は先に取っておく。iOS の Safari などは、タップの直後でないとパスキーの作成を拒むので、
// ボタンを押してから通信を待つと黙って失敗する
let prepared: { options: PublicKeyCredentialCreationOptionsJSON; fetchedAt: number } | null = null;

async function prepare(): Promise<PublicKeyCredentialCreationOptionsJSON> {
	const res = await beginIntraPasskeySetup(props.token);
	username.value = res.username;
	prepared = { options: res.options, fetchedAt: Date.now() };
	return res.options;
}

function getErrorMessage(err: unknown): string {
	if (err instanceof IntraPasskeySetupError) {
		if (err.code === 'INVALID_PASSKEY_SETUP_TOKEN') return i18n.ts._intra.passkeySetupInvalid;
		if (err.code === 'RATE_LIMIT_EXCEEDED') return i18n.ts.rateLimitExceeded;
	}
	return i18n.ts._intra.passkeySetupFailed;
}

async function createPasskey() {
	processing.value = true;
	try {
		// 準備が新しければ、await を挟まずにすぐ作成を始める。古ければ取り直す (この場合は Safari で拒まれることがある)
		const options = prepared != null && Date.now() - prepared.fetchedAt < OPTIONS_MAX_AGE_MS
			? prepared.options
			: await prepare();

		let credential;
		try {
			credential = await startRegistration({ optionsJSON: options });
		} catch (err) {
			// キャンセルや、この端末・ブラウザで作れないとき。理由を出して、もう一度押せるようにする
			os.alert({ type: 'warning', text: getPasskeyRegistrationErrorMessage(err) });
			return;
		}

		// 検証すると backend の challenge は使い切られるので、失敗したら次は取り直す
		prepared = null;
		const { i } = await completeIntraPasskeySetup(props.token, i18n.ts._intra.passkeyDefaultName, credential);
		// このページを再読み込みすると使用済みのリンクで再び登録しようとするので、トップページへ移動する
		await login(i, '/');
	} catch (err) {
		errorMessage.value = getErrorMessage(err);
	} finally {
		processing.value = false;
	}
}

onMounted(async () => {
	try {
		await prepare();
	} catch (err) {
		errorMessage.value = getErrorMessage(err);
	}
});
</script>

<style lang="scss" module>
.formContainer {
	min-height: 100svh;
	padding: 32px 32px 64px 32px;
	box-sizing: border-box;
	display: grid;
	place-content: center;
}

.form {
	position: relative;
	z-index: 10;
	border-radius: var(--MI-radius);
	box-shadow: 0 8px 16px var(--MI_THEME-shadow);
	overflow: clip;
	max-width: 500px;
}

.banner {
	padding: 16px;
	text-align: center;
	font-size: 26px;
	background-color: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.bannerError {
	background-color: color-mix(in srgb, var(--MI_THEME-error), transparent 85%);
	color: var(--MI_THEME-error);
}

.body {
	padding: 32px;
	text-align: center;
}

.processing {
	opacity: 0.7;
}
</style>
