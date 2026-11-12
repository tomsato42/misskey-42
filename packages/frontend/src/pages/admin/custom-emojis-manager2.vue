<!--
SPDX-FileCopyrightText: syuilo and other misskey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="headerTab" :tabs="headerTabs" :actions="headerActions">
	<XGridLocalComponent v-if="headerTab === 'local'" :class="$style.local"/>
	<XGridRemoteComponent v-else-if="headerTab === 'remote'"/>
	<XRegisterComponent v-else-if="headerTab === 'register'"/>
	<XTaggerComponent v-else-if="headerTab === 'tagger'"/>
</PageWithHeader>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import XGridLocalComponent from '@/pages/admin/custom-emojis-manager.local.list.vue';
import XGridRemoteComponent from '@/pages/admin/custom-emojis-manager.remote.vue';
import XRegisterComponent from '@/pages/admin/custom-emojis-manager.register.vue';
import XTaggerComponent from '@/pages/admin/custom-emojis-manager.tagger.vue';
import { iAmAdmin } from '@/i.js';
import { openMergeEmojiCategoryDialog } from '@/utility/emoji-category-merge.js';

type PageMode = 'local' | 'remote' | 'register' | 'tagger';

const headerTab = ref<PageMode>('local');

const headerTabs = computed(() => [{
	key: 'local',
	title: i18n.ts.local,
}, {
	key: 'remote',
	title: i18n.ts.remote,
}, {
	key: 'register',
	title: i18n.ts._customEmojisManager._local.tabTitleRegister,
},
// Claude にタグを提案させるのは費用がかかるので、管理者だけ
...(iAmAdmin ? [{
	key: 'tagger',
	title: i18n.ts._emojiTagging.tabTitle,
	icon: 'ti ti-sparkles',
}] : [])]);

const headerActions = computed(() => [{
	icon: 'ti ti-arrow-merge',
	text: i18n.ts._emojiCategoryMerge.title,
	handler: openMergeEmojiCategoryDialog,
}]);

definePage(computed(() => ({
	title: i18n.ts.customEmojis,
	icon: 'ti ti-icons',
	needWideArea: true,
})));
</script>

<style lang="css" module>
.local {
	height: calc(100dvh - var(--MI-stickyTop) - var(--MI-stickyBottom));
	overflow: clip;
}
</style>
