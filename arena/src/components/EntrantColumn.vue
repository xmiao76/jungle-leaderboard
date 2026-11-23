<script setup lang="ts">
import { computed } from 'vue';
import { entryByHash, groups, state } from '../app/arena';
import { uploadUrl } from '../app/paths';
import type { Seat } from '../protocol/messages';
import { RULES_DIGEST, RULES_ID } from '../referee';
import { CARD, FIELD, LABEL, ORIGIN_BADGE } from '../ui/classes';
import { seatLabel, shortHash } from '../ui/labels';

const props = defineProps<{ seat: Seat }>();

const selected = computed(() => entryByHash(state.selection[props.seat]));
const allGroups = computed(() => groups());
const selectedTitle = computed(() => selected.value?.metadata.title ?? '');
const versions = computed(() => allGroups.value.find((g) => g.title === selectedTitle.value)?.versions ?? []);
const busy = computed(() => state.match?.phase === 'loading' || state.preparing[props.seat] !== null);
const compatible = computed(() => selected.value?.metadata.rulesId === RULES_ID && selected.value?.metadata.rulesDigest === RULES_DIGEST);

function chooseTitle(event: Event) {
  const title = (event.target as HTMLSelectElement).value;
  state.selection[props.seat] = allGroups.value.find((g) => g.title === title)?.versions[0]?.sha256 ?? null;
}

function chooseVersion(event: Event) {
  state.selection[props.seat] = (event.target as HTMLSelectElement).value || null;
}

const originLabel = (origin: 'public' | 'device') => (origin === 'public' ? 'Public catalog' : 'On this device');
</script>

<template>
  <section :class="CARD" :aria-labelledby="`entrant-${seat}-title`" :data-seat="seat">
    <h3 :id="`entrant-${seat}-title`" class="font-display text-xl font-semibold">{{ seatLabel(seat) }}</h3>

    <div class="mt-4 grid gap-3">
      <label class="grid gap-1.5">
        <span :class="LABEL">Program</span>
        <select :class="FIELD" :value="selectedTitle" :disabled="busy" :data-testid="`title-${seat}`" @change="chooseTitle">
          <option value="" disabled>Choose a program…</option>
          <option v-for="group in allGroups" :key="group.title" :value="group.title">{{ group.title }}</option>
        </select>
      </label>
      <label class="grid gap-1.5">
        <span :class="LABEL">Version (each build is identified by its hash)</span>
        <select :class="FIELD" :value="state.selection[seat] ?? ''" :disabled="busy || versions.length === 0" :data-testid="`version-${seat}`" @change="chooseVersion">
          <option v-for="v in versions" :key="v.sha256" :value="v.sha256">
            v{{ v.metadata.gameVersion }} · {{ shortHash(v.sha256) }} · {{ originLabel(v.origin) }}<template v-if="v.metadata.modelPlatform"> · {{ v.metadata.modelPlatform }}</template>
          </option>
        </select>
      </label>
    </div>

    <p v-if="state.preparing[seat]" class="mt-4 text-sm text-muted" role="status">Preparing: {{ state.preparing[seat] }}</p>

    <dl v-if="selected" class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt class="text-subtle">Catalog</dt>
      <dd class="flex flex-wrap items-center gap-2">
        <span :class="ORIGIN_BADGE[selected.origin]">{{ originLabel(selected.origin) }}</span>
        <span v-if="selected.origin === 'public' && selected.onDevice" class="text-xs text-subtle">also stored on this device</span>
      </dd>
      <dt class="text-subtle">Model</dt>
      <dd>{{ selected.metadata.model }}</dd>
      <dt class="text-subtle">Code agent</dt>
      <dd>{{ selected.metadata.codeAgent }}</dd>
      <template v-if="selected.metadata.modelPlatform">
        <dt class="text-subtle">Model platform</dt>
        <dd>{{ selected.metadata.modelPlatform }}</dd>
      </template>
      <template v-if="selected.metadata.githubUrl">
        <dt class="text-subtle">GitHub</dt>
        <dd><a :href="selected.metadata.githubUrl" target="_blank" rel="noreferrer noopener" class="text-accent underline underline-offset-2 break-all">{{ selected.metadata.githubUrl }}</a></dd>
      </template>
      <dt class="text-subtle">Game version</dt>
      <dd>{{ selected.metadata.gameVersion }}</dd>
      <dt class="text-subtle">Engine</dt>
      <dd>{{ selected.metadata.engineVersion }}</dd>
      <dt class="text-subtle">Runtime</dt>
      <dd>{{ selected.metadata.runtime }}</dd>
      <dt class="text-subtle">Rules</dt>
      <dd>
        <span v-if="compatible" class="font-semibold text-accent">Compatible</span>
        <span v-else class="font-semibold text-bronze">Incompatible</span>
        · {{ selected.metadata.rulesId }}
      </dd>
      <dt class="text-subtle">SHA-256</dt>
      <dd class="font-mono text-xs break-all" :title="selected.sha256">{{ selected.sha256 }}</dd>
      <template v-if="selected.provenance">
        <dt class="text-subtle">Source</dt>
        <dd>{{ selected.provenance.language }} · {{ selected.provenance.toolchain }}</dd>
      </template>
      <template v-if="selected.credits">
        <dt class="text-subtle">Credits</dt>
        <dd class="text-xs">{{ selected.credits }}</dd>
      </template>
    </dl>
    <p v-else class="mt-5 text-sm text-subtle">
      No program selected. Pick one above, or <a :href="uploadUrl()" class="text-accent underline underline-offset-2">upload a .wasm</a>.
    </p>
  </section>
</template>
