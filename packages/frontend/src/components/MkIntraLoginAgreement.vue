<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<I18n v-if="tosUrl || privacyPolicyUrl" :src="i18n.ts._intra.agreementOnLogin" tag="p" :class="$style.root">
	<template #documents>
		<a v-if="tosUrl" :href="tosUrl" class="_link" target="_blank" rel="noopener">{{ i18n.ts.termsOfService }}</a>
		<template v-if="tosUrl && privacyPolicyUrl">{{ i18n.ts._intra.agreementDocumentsSeparator }}</template>
		<a v-if="privacyPolicyUrl" :href="privacyPolicyUrl" class="_link" target="_blank" rel="noopener">{{ i18n.ts.privacyPolicy }}</a>
	</template>
</I18n>
</template>

<script lang="ts" setup>
// 42 のログインでは登録の画面 (MkSignupDialog.rules.vue) を通らずにアカウントが作られるので、
// ログインのボタンの近くで利用規約とプライバシーポリシーへの同意を示す
import { i18n } from '@/i18n.js';

defineProps<{
	tosUrl?: string | null;
	privacyPolicyUrl?: string | null;
}>();
</script>

<style lang="scss" module>
.root {
	margin: 0;
	text-align: center;
	font-size: 0.85em;
	opacity: 0.7;
}
</style>
