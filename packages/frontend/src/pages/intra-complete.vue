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
				<i v-else class="ti ti-school"></i>
			</div>
			<div class="_gaps_m" :class="$style.body">
				<template v-if="errorMessage != null">
					<div role="alert">{{ errorMessage }}</div>
					<div>
						<MkButton gradate large rounded style="margin: 0 auto;" data-testid="intra-login-again" @click="startIntraLogin">
							<i class="ti ti-school"></i> {{ i18n.ts._intra.loginAgain }}
						</MkButton>
					</div>
				</template>
				<template v-else>
					<MkLoading/>
					<div role="status" :class="$style.processing">{{ i18n.ts._intra.loggingIn }}<MkEllipsis/></div>
				</template>
			</div>
		</div>
	</div>
</PageWithAnimBg>
</template>

<script lang="ts">
// 交換済みのコード。コードは 1 回しか使えないので、ページが作り直されても同じコードで再び交換しない
const exchangedCodes = new Set<string>();
</script>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';
import { exchangeIntraLoginCode, IntraExchangeError, startIntraLogin } from '@/utility/intra-login.js';

const props = defineProps<{
	code: string;
	reason?: string;
}>();

// backend が /intra-complete/error?reason=... にリダイレクトするときの理由
const failureMessages = new Map<string, string>([
	['not_eligible', i18n.ts._intra._errors.notEligible],
	['suspended', i18n.ts._intra._errors.suspended],
	['username_taken', i18n.ts._intra._errors.usernameTaken],
	['invalid_state', i18n.ts._intra._errors.invalidState],
	['intra_error', i18n.ts._intra._errors.intraError],
]);

const errorMessage = ref<string | null>(null);

function getExchangeErrorMessage(err: unknown): string {
	if (err instanceof IntraExchangeError) {
		if (err.code === 'INVALID_INTRA_LOGIN_CODE') return i18n.ts._intra.exchangeFailed;
		if (err.code === 'RATE_LIMIT_EXCEEDED') return i18n.ts.rateLimitExceeded;
	}
	// それ以外のエラー応答や、fetch 自体の失敗 (ネットワークエラーなど)
	return i18n.ts._intra.unknownError;
}

async function exchange() {
	if (exchangedCodes.has(props.code)) return;
	exchangedCodes.add(props.code);

	let token: string;
	try {
		token = (await exchangeIntraLoginCode(props.code)).i;
	} catch (err) {
		errorMessage.value = getExchangeErrorMessage(err);
		return;
	}

	try {
		// このページを再読み込みすると使用済みのコードで再び交換しようとするので、トップページへ移動する
		await login(token, '/');
	} catch {
		errorMessage.value = i18n.ts._intra.unknownError;
	}
}

onMounted(() => {
	if (props.code === 'error') {
		errorMessage.value = failureMessages.get(props.reason ?? '') ?? i18n.ts._intra.unknownError;
		return;
	}
	exchange();
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
