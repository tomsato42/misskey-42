<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.wrapper" data-testid="signin-page-input">
	<div :class="$style.root">
		<div :class="$style.avatar">
			<i class="ti ti-user"></i>
		</div>

		<!-- ログイン画面メッセージ -->
		<MkInfo v-if="message">
			{{ message }}
		</MkInfo>

		<!-- 42 intra でのログイン -->
		<div v-if="instance.intraLoginEnabled" class="_gaps_s">
			<MkButton type="button" large primary rounded gradate style="margin: 0 auto;" data-testid="signin-intra" @click="startIntraLogin">
				<i class="ti ti-school"></i> {{ i18n.ts._intra.loginWithIntra }}
			</MkButton>
			<p :class="$style.intraCaption">{{ i18n.ts._intra.autoSignupDescription }}</p>
		</div>

		<!-- 42 にログインできなくなった人 (ブラックホールなど) は、登録しておいたパスキーでログインする。管理者ログインを開いているときは下にあるので出さない -->
		<div v-if="instance.intraLoginEnabled && !showLocalSignin" class="_gaps_s">
			<MkButton type="button" rounded style="margin: 0 auto;" data-testid="signin-intra-passkey" @click="emit('passkeyClick', $event)">
				<i class="ti ti-key"></i> {{ i18n.ts.signinWithPasskey }}
			</MkButton>
			<p :class="$style.intraCaption">{{ i18n.ts._intra.passkeyLoginDescription }}</p>
		</div>

		<!-- intra 連携が有効なときは、ここから下 (ユーザー名・パスキーでのログインなど) を折りたたみの中に入れる。
		無効なときは div になり、Vue は通常の要素に default 以外のスロットを描画しないので、upstream と同じ表示になる -->
		<component :is="localSigninWrapper.component" v-if="showLocalSignin" v-bind="localSigninWrapper.props">
			<template #icon><i class="ti ti-shield-lock"></i></template>
			<template #label>{{ i18n.ts._intra.passwordLogin }}</template>
			<template #caption>{{ i18n.ts._intra.passwordLoginDescription }}</template>

			<div :class="[$style.localSignin, { [$style.inFolder]: instance.intraLoginEnabled }]">
				<!-- 外部サーバーへの転送 -->
				<div v-if="openOnRemote" class="_gaps_m">
					<div class="_gaps_s">
						<MkButton type="button" rounded primary style="margin: 0 auto;" @click="openRemote(openOnRemote)">
							{{ i18n.ts.continueOnRemote }} <i class="ti ti-external-link"></i>
						</MkButton>
						<button type="button" class="_button" :class="$style.instanceManualSelectButton" @click="specifyHostAndOpenRemote(openOnRemote)">
							{{ i18n.ts.specifyServerHost }}
						</button>
					</div>
					<div :class="$style.orHr">
						<p :class="$style.orMsg">{{ i18n.ts.or }}</p>
					</div>
				</div>

				<!-- username入力 -->
				<form class="_gaps_s" @submit.prevent="emit('usernameSubmitted', username)">
					<MkInput v-model="username" :placeholder="i18n.ts.username" type="text" pattern="^[a-zA-Z0-9_]+$" :spellcheck="false" autocomplete="username webauthn" autofocus required data-testid="signin-username">
						<template #prefix>@</template>
						<template #suffix>@{{ host }}</template>
					</MkInput>
					<MkButton type="submit" large primary rounded style="margin: 0 auto;" data-testid="signin-page-input-continue">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
				</form>

				<!-- パスワードレスログイン -->
				<div :class="$style.orHr">
					<p :class="$style.orMsg">{{ i18n.ts.or }}</p>
				</div>
				<div>
					<MkButton type="submit" style="margin: auto auto;" large rounded primary gradate @click="emit('passkeyClick', $event)">
						<i class="ti ti-device-usb" style="font-size: medium;"></i>{{ i18n.ts.signinWithPasskey }}
					</MkButton>
				</div>
			</div>
		</component>
	</div>
</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { toUnicode } from 'punycode.js';

import { query, extractDomain } from '@@/js/url.js';
import { host as configHost } from '@@/js/config.js';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { instance } from '@/instance.js';
import { startIntraLogin } from '@/utility/intra-login.js';

import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFolder from '@/components/MkFolder.vue';

const props = withDefaults(defineProps<{
	message?: string,
	openOnRemote?: OpenOnRemoteOptions,
	initialUsername?: string;
}>(), {
	message: '',
	openOnRemote: undefined,
	initialUsername: undefined,
});

const emit = defineEmits<{
	(ev: 'usernameSubmitted', v: string): void;
	(ev: 'passkeyClick', v: PointerEvent): void;
}>();

const host = toUnicode(configHost);

const username = ref(props.initialUsername ?? '');

// intra 連携が無効なら upstream と同じく折りたたまずに表示する。ダイアログ内なので MkFolder のページ表示は使わない
const localSigninWrapper = instance.intraLoginEnabled
	? { component: MkFolder, props: { canPage: false, defaultOpen: true } }
	: { component: 'div', props: {} };

// intra 連携が有効なとき、パスワード・パスキーでのログイン (管理者向け) は URL に ?admin-login を付けたときだけ表示する
const showLocalSignin = !instance.intraLoginEnabled || new URLSearchParams(window.location.search).has('admin-login');

//#region Open on remote
function openRemote(options: OpenOnRemoteOptions, targetHost?: string): void {
	switch (options.type) {
		case 'web':
		case 'lookup': {
			let _path: string;

			if (options.type === 'lookup') {
				// TODO: v2024.7.0以降が浸透してきたら正式なURLに変更する▼
				// _path = `/lookup?uri=${encodeURIComponent(_path)}`;
				_path = `/authorize-follow?acct=${encodeURIComponent(options.url)}`;
			} else {
				_path = options.path;
			}

			if (targetHost) {
				window.open(`https://${targetHost}${_path}`, '_blank', 'noopener');
			} else {
				window.open(`https://misskey-hub.net/mi-web/?path=${encodeURIComponent(_path)}`, '_blank', 'noopener');
			}
			break;
		}
		case 'share': {
			const params = query(options.params);
			if (targetHost) {
				window.open(`https://${targetHost}/share?${params}`, '_blank', 'noopener');
			} else {
				window.open(`https://misskey-hub.net/share/?${params}`, '_blank', 'noopener');
			}
			break;
		}
	}
}

async function specifyHostAndOpenRemote(options: OpenOnRemoteOptions): Promise<void> {
	const { canceled, result: hostTemp } = await os.inputText({
		title: i18n.ts.inputHostName,
		placeholder: 'misskey.example.com',
	});

	if (canceled) return;

	let targetHost: string | null = hostTemp;

	// ドメイン部分だけを取り出す
	targetHost = extractDomain(targetHost ?? '');
	if (targetHost == null) {
		os.alert({
			type: 'error',
			title: i18n.ts.invalidValue,
			text: i18n.ts.tryAgain,
		});
		return;
	}
	openRemote(options, targetHost);
}
//#endregion
</script>

<style lang="scss" module>
.root,
.localSignin {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.wrapper {
	display: flex;
	align-items: center;
	width: 100%;
	min-height: 336px;

	> .root {
		width: 100%;
	}
}

.avatar {
	margin: 0 auto;
	background-color: color-mix(in srgb, var(--MI_THEME-fg), transparent 85%);
	color: color-mix(in srgb, var(--MI_THEME-fg), transparent 25%);
	text-align: center;
	height: 64px;
	width: 64px;
	font-size: 24px;
	line-height: 64px;
	border-radius: 50%;
}

.intraCaption {
	margin: 0;
	text-align: center;
	font-size: 0.85em;
	opacity: 0.7;
}

.instanceManualSelectButton {
	display: block;
	text-align: center;
	opacity: .7;
	font-size: .8em;

	&:hover {
		text-decoration: underline;
	}
}

.orHr {
	position: relative;
	margin: .4em auto;
	width: 100%;
	height: 1px;
	background: var(--MI_THEME-divider);
}

.orMsg {
	position: absolute;
	top: -.6em;
	display: inline-block;
	padding: 0 1em;
	background: var(--MI_THEME-panel);
	font-size: 0.8em;
	color: var(--MI_THEME-fgOnPanel);
	margin: 0;
	left: 50%;
	transform: translateX(-50%);
}
.inFolder {
	// MkFolder の本文の背景色は置かれた場所によって変わるので、「もしくは」の文字の背景で線を隠さずに左右へ線を引く
	.orHr {
		display: flex;
		align-items: center;
		gap: 1em;
		height: auto;
		background: none;

		&::before,
		&::after {
			content: '';
			flex: 1;
			height: 1px;
			background: var(--MI_THEME-divider);
		}
	}

	.orMsg {
		position: static;
		transform: none;
		padding: 0;
		background: none;
	}
}
</style>
