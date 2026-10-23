<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
42 intra 連携が有効なとき (学内SNSモード) に、未ログインの訪問者へ見せる唯一の画面。
どの URL を開いてもこの画面だけを表示し、ルーターのページは読み込まない (/intra-complete だけは sub-boot の通常の画面で表示する)
-->

<template>
<div :class="$style.root">
	<!-- 管理者アカウントがまだ無いときは、最初の管理者を作成する画面を出す -->
	<XSetup v-if="instance.requireSetup"/>
	<PageWithAnimBg v-else>
		<div :class="$style.formContainer">
			<main :class="$style.form" class="_panel">
				<div :class="$style.header">
					<img :src="instance.iconUrl || '/favicon.ico'" alt="" :class="$style.icon"/>
					<h1 :class="$style.title">{{ instanceName }}</h1>
				</div>
				<div :class="$style.signin" class="_gaps_m">
					<!-- 2次元コードから来た人には、ログインするとコードを見せた人のページが開くことを伝える -->
					<MkInfo v-if="fromQr">{{ i18n.ts._intra.qrInviteDescription }}</MkInfo>
					<MkSignin :autoSet="true"/>
				</div>
			</main>
		</div>
	</PageWithAnimBg>
</div>
<XCommon/>
</template>

<script lang="ts" setup>
import { instanceName } from '@@/js/config.js';
import XCommon from './_common_/common.vue';
import XSetup from '@/pages/welcome.setup.vue';
import MkSignin from '@/components/MkSignin.vue';
import MkInfo from '@/components/MkInfo.vue';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { getQrReferrerId } from '@/utility/intra-login.js';

const fromQr = getQrReferrerId(window.location.pathname) != null;

window.document.title = instanceName;
</script>

<style lang="scss" module>
.root {
	position: relative;
	height: 100dvh;
}

.formContainer {
	min-height: 100svh;
	padding: 32px 16px 64px 16px;
	box-sizing: border-box;
	display: grid;
	place-content: center;
}

.form {
	position: relative;
	z-index: 10;
	width: 400px;
	max-width: 100%;
	box-sizing: border-box;
	border-radius: var(--MI-radius);
	box-shadow: 0 8px 16px var(--MI_THEME-shadow);
	overflow: clip;
}

.header {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 16px 24px;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.icon {
	width: 40px;
	height: 40px;
	border-radius: 8px;
	object-fit: cover;
}

.title {
	margin: 0;
	font-size: 1.1em;
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.signin {
	padding: 32px;
}
</style>
