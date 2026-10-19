<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="480"
	:height="640"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._pairRecruitment.shareTitle }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_s">
			<div :class="$style.description">{{ i18n.ts._pairRecruitment.shareDescription }}</div>
			<MkTextarea v-model="text" tall/>
		</div>
	</div>

	<template #footer>
		<div class="_buttons" :class="$style.footer">
			<MkButton rounded @click="copyLink"><i class="ti ti-link"></i> {{ i18n.ts._pairRecruitment.copyLinkOnly }}</MkButton>
			<MkButton primary rounded :disabled="text.trim() === ''" @click="copyText"><i class="ti ti-copy"></i> {{ i18n.ts._pairRecruitment.copyText }}</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
// 募集をほかの場所 (Slack など) に貼るための文章を作り、編集してコピーするダイアログ。リンクだけもコピーできる。
// 開くときは utility/pair-recruitment-dialog.ts の openPairShareDialog を使う
import { ref, useTemplateRef } from 'vue';
import { url } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { i18n } from '@/i18n.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { buildPairShareText, getPairRecruitmentUrl } from '@/utility/pair-recruitment.js';

const props = defineProps<{
	recruitment: Misskey.entities.PairRecruitmentDetailed;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const link = getPairRecruitmentUrl(url, props.recruitment.id);
const text = ref(buildPairShareText(props.recruitment, link));

function copyText() {
	copyToClipboard(text.value);
}

function copyLink() {
	copyToClipboard(link);
}
</script>

<style lang="scss" module>
.description {
	font-size: 0.85em;
	opacity: 0.75;
}

.footer {
	justify-content: flex-end;
	flex-wrap: wrap;
}
</style>
