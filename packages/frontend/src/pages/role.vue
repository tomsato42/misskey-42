<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs">
	<div v-if="error != null" class="_spacer" style="--MI_SPACER-w: 1200px;">
		<MkResult type="error" :text="error"/>
	</div>
	<div v-else-if="tab === 'users'" class="_spacer" style="--MI_SPACER-w: 1200px;">
		<div class="_gaps_s">
			<div v-if="role">{{ role.description }}</div>
			<MkUserList v-if="visible" :paginator="usersPaginator" :extractor="(item) => item.user"/>
			<MkResult v-else-if="!visible" type="empty" :text="i18n.ts.nothing"/>
		</div>
	</div>
	<div v-else-if="tab === 'timeline'" class="_spacer" style="--MI_SPACER-w: 700px;">
		<MkStreamingNotesTimeline v-if="visible" ref="timeline" src="role" :role="props.roleId"/>
		<MkResult v-else-if="!visible" type="empty" :text="i18n.ts.nothing"/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, ref, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkUserList from '@/components/MkUserList.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import { Paginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { addPinnedRole, removePinnedRole } from '@/utility/pinned-roles.js';
import type { PageHeaderItem } from '@/types/page-header.js';

const props = withDefaults(defineProps<{
	roleId: string;
	initialTab?: string;
}>(), {
	initialTab: 'users',
});

// eslint-disable-next-line vue/no-setup-props-reactivity-loss
const tab = ref(props.initialTab);
const role = ref<Misskey.entities.Role | null>(null);
const error = ref<string | null>(null);
const visible = ref(false);

watch(() => props.roleId, () => {
	misskeyApi('roles/show', {
		roleId: props.roleId,
	}).then(res => {
		role.value = res;
		error.value = null;
		visible.value = res.isExplorable && res.isPublic;
		// タブに足したあとでロール名が変わっていたら、タブの名前も合わせる
		if (prefer.s.pinnedRoles.some(r => r.id === res.id && r.name !== res.name)) {
			prefer.commit('pinnedRoles', prefer.s.pinnedRoles.map(r => r.id === res.id ? { id: r.id, name: res.name } : r));
		}
	}).catch((err) => {
		if (err.code === 'NO_SUCH_ROLE') {
			error.value = i18n.ts.noRole;
		} else {
			error.value = i18n.ts.somethingHappened;
		}
	});
}, { immediate: true });

const usersPaginator = markRaw(new Paginator('roles/users', {
	limit: 30,
	computedParams: computed(() => ({
		roleId: props.roleId,
	})),
}));

const isPinned = computed(() => prefer.r.pinnedRoles.value.some(r => r.id === props.roleId));

// タイムラインのタブに足せるのは、タイムラインを見られるロール (公開かつ見つけやすくする) だけ
const headerActions = computed<PageHeaderItem[]>(() => {
	if ($i == null || role.value == null || !visible.value) return [];
	const currentRole = role.value;
	return [isPinned.value ? {
		icon: 'ti ti-pinned-off',
		text: i18n.ts._roleTimeline.removeFromTimelineTabs,
		handler: () => {
			prefer.commit('pinnedRoles', [...removePinnedRole(prefer.s.pinnedRoles, currentRole.id)]);
		},
	} : {
		icon: 'ti ti-pin',
		text: i18n.ts._roleTimeline.addToTimelineTabs,
		handler: () => {
			prefer.commit('pinnedRoles', [...addPinnedRole(prefer.s.pinnedRoles, currentRole)]);
		},
	}];
});

const headerTabs = computed(() => [{
	key: 'users',
	icon: 'ti ti-users',
	title: i18n.ts.users,
}, {
	key: 'timeline',
	icon: 'ti ti-pencil',
	title: i18n.ts.timeline,
}]);

definePage(() => ({
	title: role.value ? role.value.name : (error.value ?? i18n.ts.role),
	icon: 'ti ti-badge',
}));
</script>
