<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
42times: ユーザー ID の URL (/users/:userId) から、ユーザーのページへ移る。
2次元コードはこの URL を指す。学内SNSモードの backend は、ID からユーザー名が分からないよう、ここでリダイレクトせずに SPA を返す
-->

<template>
<div style="align-content: center; height: 100cqh;">
	<MkResult v-if="notFound" type="notFound" :text="i18n.ts.notFoundDescription"/>
	<MkLoading v-else/>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	userId: string;
}>();

const router = useRouter();
const notFound = ref(false);

misskeyApi('users/show', { userId: props.userId }).then(user => {
	router.replace('/@:acct/:page?', {
		params: {
			acct: user.host != null ? `${user.username}@${user.host}` : user.username,
		},
	});
}).catch(() => {
	notFound.value = true;
});

definePage(() => ({
	title: i18n.ts.user,
	icon: 'ti ti-user',
}));
</script>
