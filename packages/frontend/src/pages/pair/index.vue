<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div :class="$style.filters">
				<MkSelect v-model="projectSlug" :items="projectItems" :class="$style.projectFilter">
					<template #label>{{ i18n.ts._pairRecruitment.filterByProject }}</template>
				</MkSelect>
				<MkSwitch v-if="tab === 'open'" v-model="onlyWorkable" :class="$style.onlyWorkable">
					<template #label>{{ i18n.ts._pairRecruitment.onlyWorkable }}</template>
				</MkSwitch>
				<MkButton primary rounded :class="$style.recruit" @click="router.push('/pair/new')">
					<i class="ti ti-plus"></i> {{ i18n.ts._pairRecruitment.recruit }}
				</MkButton>
			</div>

			<MkPagination :paginator="paginator">
				<template #empty>
					<MkResult type="empty" :text="emptyText"/>
				</template>
				<template #default="{ items }">
					<div class="_panel" :class="$style.list">
						<MkPairRecruitmentCard
							v-for="recruitment in items"
							:key="recruitment.id"
							:recruitment="recruitment"
							@updated="(updated) => paginator.updateItem(recruitment.id, () => updated)"
						/>
					</div>
				</template>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MkSelectItem } from '@/components/MkSelect.vue';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkButton from '@/components/MkButton.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkPairRecruitmentCard from '@/components/MkPairRecruitmentCard.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { Paginator } from '@/utility/paginator.js';

type Tab = 'open' | 'mine' | 'joined';

const router = useRouter();

const tab = ref<Tab>('open');
const projectSlug = ref<string | null>(null);
const onlyWorkable = ref(false);
const projects = ref<Misskey.entities.PairRecruitmentProject[]>([]);

// 絞り込みの課題の一覧。取得に失敗しても一覧は見られるので、失敗は無視して「すべての課題」だけにする
misskeyApi('pair-recruitments/projects').then((res) => {
	projects.value = res;
}).catch(() => {});

const projectItems = computed<MkSelectItem<string | null>[]>(() => [
	{ value: null, label: i18n.ts._pairRecruitment.allProjects },
	...projects.value.map(p => ({
		value: p.slug,
		label: p.openRecruitmentCount > 0
			? i18n.tsx._pairRecruitment.projectWithOpenCount({ name: p.name, n: p.openRecruitmentCount })
			: p.name,
	})),
]);

const paginator = markRaw(new Paginator('pair-recruitments/list', {
	limit: 10,
	computedParams: computed(() => ({
		tab: tab.value,
		projectSlug: projectSlug.value,
		onlyWorkable: tab.value === 'open' && onlyWorkable.value,
	})),
}));

const emptyText = computed(() => {
	switch (tab.value) {
		case 'mine': return i18n.ts._pairRecruitment.emptyMine;
		case 'joined': return i18n.ts._pairRecruitment.emptyJoined;
		default: return i18n.ts._pairRecruitment.emptyOpen;
	}
});

const headerActions = computed<PageHeaderItem[]>(() => [{
	icon: 'ti ti-plus',
	text: i18n.ts._pairRecruitment.recruit,
	handler: () => {
		router.push('/pair/new');
	},
}]);

const headerTabs = computed(() => [{
	key: 'open',
	title: i18n.ts._pairRecruitment.tabOpen,
	icon: 'ti ti-users-group',
}, {
	key: 'mine',
	title: i18n.ts._pairRecruitment.tabMine,
	icon: 'ti ti-user',
}, {
	key: 'joined',
	title: i18n.ts._pairRecruitment.tabJoined,
	icon: 'ti ti-user-check',
}]);

definePage(() => ({
	title: i18n.ts._pairRecruitment.title,
	icon: 'ti ti-users-group',
}));
</script>

<style lang="scss" module>
.filters {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 12px;
}

.projectFilter {
	flex: 1 1 220px;
}

.onlyWorkable {
	padding-bottom: 6px;
}

.list {
	& > * + * {
		border-top: 0.5px solid var(--MI_THEME-divider);
	}
}
</style>
