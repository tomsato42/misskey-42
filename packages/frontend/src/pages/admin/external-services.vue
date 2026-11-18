<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/external-services" :label="i18n.ts.externalServices" :keywords="['external', 'services', 'thirdparty']" icon="ti ti-link">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>Google Analytics</SearchLabel><span class="_beta">{{ i18n.ts.beta }}</span></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="googleAnalyticsMeasurementId">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>Measurement ID</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<MkButton primary @click="save_googleAnalytics">Save</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>DeepL Translation</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="deeplAuthKey">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>Auth Key</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="deeplIsPro">
									<template #label><SearchLabel>Pro account</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>

							<MkButton primary @click="save_deepl">Save</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps" :keywords="['claude', 'anthropic', 'ai', 'emoji']">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>Claude (Anthropic)</SearchLabel></template>
						<template #caption>{{ i18n.ts._emojiTagging.serviceDescription }}</template>
						<template #suffix>{{ anthropicApiKeyHint != null ? i18n.tsx._emojiTagging.apiKeyConfigured({ hint: anthropicApiKeyHint }) : i18n.ts._emojiTagging.apiKeyNotConfigured }}</template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="anthropicApiKey" type="password" autocomplete="new-password" :placeholder="anthropicApiKeyHint != null ? `••••${anthropicApiKeyHint}` : 'sk-ant-...'">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>{{ i18n.ts._emojiTagging.apiKey }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._emojiTagging.apiKeyCaption }}</template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkSelect v-model="anthropicModel" :items="anthropicModelDef">
									<template #label><SearchLabel>{{ i18n.ts._emojiTagging.model }}</SearchLabel></template>
								</MkSelect>
							</SearchMarker>

							<SearchMarker :keywords="['translate', 'translation', 'deepl']">
								<MkSwitch v-model="anthropicTranslationEnabled">
									<template #label><SearchLabel>{{ i18n.ts._emojiTagging.useForTranslation }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._emojiTagging.useForTranslationCaption }}</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker v-if="anthropicTranslationEnabled">
								<MkSelect v-model="anthropicTranslationModel" :items="anthropicTranslationModelDef">
									<template #label><SearchLabel>{{ i18n.ts._emojiTagging.translationModel }}</SearchLabel></template>
								</MkSelect>
							</SearchMarker>

							<div class="_buttons">
								<MkButton primary @click="save_anthropic">{{ i18n.ts.save }}</MkButton>
								<MkButton :disabled="anthropicApiKeyHint == null" @click="test_anthropic">{{ i18n.ts._emojiTagging.testConnection }}</MkButton>
								<MkButton danger :disabled="anthropicApiKeyHint == null" @click="delete_anthropic">{{ i18n.ts._emojiTagging.deleteKey }}</MkButton>
							</div>
						</div>
					</MkFolder>
				</SearchMarker>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkSelect from '@/components/MkSelect.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFolder from '@/components/MkFolder.vue';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { CLAUDE_TRANSLATION_MODELS, EMOJI_TAGGING_MODELS, emojiTaggingErrorMessage, isEmojiTaggingAvailable } from '@/utility/emoji-tagging.js';

const meta = await misskeyApi('admin/meta');

const deeplAuthKey = ref(meta.deeplAuthKey ?? '');
const deeplIsPro = ref(meta.deeplIsPro);
const googleAnalyticsMeasurementId = ref(meta.googleAnalyticsMeasurementId ?? '');
// 保存したキーは返ってこないので、入力欄は新しいキーを入れるときだけ使う
const anthropicApiKey = ref('');
const anthropicApiKeyHint = ref(meta.anthropicApiKeyHint);
const {
	model: anthropicModel,
	def: anthropicModelDef,
} = useMkSelect({
	items: EMOJI_TAGGING_MODELS.map(it => ({ label: it.label, value: it.value })),
	initialValue: meta.anthropicModel,
});
const anthropicTranslationEnabled = ref(meta.anthropicTranslationEnabled);
const {
	model: anthropicTranslationModel,
	def: anthropicTranslationModelDef,
} = useMkSelect({
	items: CLAUDE_TRANSLATION_MODELS.map(it => ({ label: it.label, value: it.value })),
	initialValue: meta.anthropicTranslationModel,
});

function save_deepl() {
	os.apiWithDialog('admin/update-meta', {
		deeplAuthKey: deeplAuthKey.value,
		deeplIsPro: deeplIsPro.value,
	}).then(() => {
		fetchInstance(true);
	});
}

async function refreshAnthropicApiKeyHint() {
	const latest = await misskeyApi('admin/meta');
	anthropicApiKeyHint.value = latest.anthropicApiKeyHint;
	isEmojiTaggingAvailable(true);
}

async function save_anthropic() {
	await os.apiWithDialog('admin/update-meta', {
		// 空のまま保存したときは今のキーを残す
		...(anthropicApiKey.value.trim() !== '' ? { anthropicApiKey: anthropicApiKey.value.trim() } : {}),
		anthropicModel: anthropicModel.value,
		anthropicTranslationEnabled: anthropicTranslationEnabled.value,
		anthropicTranslationModel: anthropicTranslationModel.value,
	});
	anthropicApiKey.value = '';
	// 翻訳を使えるか (translatorAvailable) が変わるので、インスタンスの情報も取り直す
	fetchInstance(true);
	await refreshAnthropicApiKeyHint();
}

async function test_anthropic() {
	try {
		await misskeyApi('admin/emoji/test-tagging', {});
		os.alert({ type: 'success', text: i18n.ts._emojiTagging.testSucceeded });
	} catch (err) {
		os.alert({ type: 'error', text: emojiTaggingErrorMessage(err) });
	}
}

async function delete_anthropic() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._emojiTagging.deleteKeyConfirm,
	});
	if (canceled) return;

	await os.apiWithDialog('admin/update-meta', { anthropicApiKey: null });
	await refreshAnthropicApiKeyHint();
}

function save_googleAnalytics() {
	os.apiWithDialog('admin/update-meta', {
		googleAnalyticsMeasurementId: googleAnalyticsMeasurementId.value,
	}).then(() => {
		fetchInstance(true);
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.externalServices,
	icon: 'ti ti-link',
}));
</script>
