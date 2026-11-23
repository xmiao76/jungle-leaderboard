<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { importFile, UPLOAD_STAGES, useInSeat, type ImportResult, type UploadStage } from '../app/arena';
import { MAX_UPLOAD_BYTES } from '../loader/limits';
import type { Seat } from '../protocol/messages';
import { BTN, CARD, LABEL } from '../ui/classes';
import { shortHash } from '../ui/labels';
import { presentFrame } from '../ui/present';

const STAGE_TEXT: Record<UploadStage, string> = {
  size: 'Size limit',
  header: 'Component format',
  hash: 'SHA-256',
  contract: 'Imports and exported types vs. the WIT',
  transpile: 'Browser bindings (jco)',
  smoke: 'Metadata, start-up, one move, two frames',
  checks: 'Same move after rendering; isolated copies; flip',
  'game-1': 'Game 1 vs the reference — your program moves first',
  'game-2': 'Game 2 vs the reference — colours swapped',
  publish: 'Bot check and publishing to the Arena',
};

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const fileName = ref('');
const current = ref<UploadStage | null>(null);
const done = ref<UploadStage[]>([]);
/** Plies played so far in each game of the upload round. */
const plies = ref<Partial<Record<UploadStage, number>>>({});
const result = ref<ImportResult | null>(null);
const preview0 = ref<HTMLCanvasElement | null>(null);
const preview1 = ref<HTMLCanvasElement | null>(null);
const dragging = ref(false);

function stageState(stage: UploadStage): 'done' | 'active' | 'failed' | 'pending' {
  const outcome = result.value?.outcome;
  if (outcome && !outcome.ok && outcome.stage === stage) return 'failed';
  if (done.value.includes(stage)) return 'done';
  if (current.value === stage) return 'active';
  return 'pending';
}

async function run(file: File) {
  busy.value = true;
  result.value = null;
  done.value = [];
  current.value = null;
  plies.value = {};
  fileName.value = file.name;
  try {
    result.value = await importFile(file, {
      onStage: (stage) => {
        if (current.value) done.value.push(current.value);
        current.value = stage;
      },
      onPly: (stage, count) => {
        plies.value = { ...plies.value, [stage]: count };
      },
    });
    const outcome = result.value.outcome;
    if (outcome.ok) {
      if (current.value) done.value.push(current.value);
      current.value = null;
      await nextTick();
      if (preview0.value && outcome.frames[0]) presentFrame(preview0.value, outcome.frames[0]);
      if (preview1.value && outcome.frames[1]) presentFrame(preview1.value, outcome.frames[1]);
    }
  } finally {
    busy.value = false;
    if (input.value) input.value.value = '';
  }
}

function onPick() {
  const file = input.value?.files?.[0];
  if (file) void run(file);
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file && !busy.value) void run(file);
}

/** Put the admitted program in a seat and open the Arena page to play it. */
function useIn(seat: Seat) {
  const outcome = result.value?.outcome;
  if (outcome?.ok) useInSeat(seat, outcome.sha256);
}
</script>

<template>
  <section :class="CARD" aria-labelledby="import-title">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-2xl">
        <h3 id="import-title" class="font-display text-xl font-semibold">Check, test and publish a component</h3>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          Select one Component Model binary that implements <code class="font-mono text-xs">jungle:arena/competitor@1.0.0</code>.
          It is checked here before any of its code runs, tested in two games against the Arena’s reference program, and then
          <strong>published to the shared Arena catalog</strong> under its SHA-256, starting at an Elo rating of 1000. If any step
          fails, nothing is stored. Uploading the same bytes again reuses the entry. Up to {{ MAX_UPLOAD_BYTES / 1048576 }} MiB.
        </p>
      </div>
      <label :class="[BTN.primary, busy ? 'pointer-events-none opacity-60' : 'cursor-pointer']">
        <input
          ref="input"
          type="file"
          accept=".wasm,application/wasm"
          class="sr-only"
          data-testid="import-input"
          :disabled="busy"
          @change="onPick"
        />
        {{ busy ? 'Checking…' : 'Import .wasm' }}
      </label>
    </div>

    <div
      :class="['mt-4 rounded-xl border border-dashed px-4 py-3 text-center text-xs text-subtle transition', dragging ? 'border-accent bg-accent-soft' : 'border-line-strong']"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      or drop a .wasm file here
    </div>

    <div v-if="fileName" class="mt-5" data-testid="import-progress">
      <p :class="LABEL">Checking {{ fileName }}</p>
      <ol class="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
        <li v-for="(stage, i) in UPLOAD_STAGES" :key="stage" class="flex items-center gap-2" :data-stage="stage" :data-state="stageState(stage)">
          <span
            class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-semibold"
            :class="{
              'border-accent bg-accent text-accent-ink': stageState(stage) === 'done',
              'border-accent text-accent': stageState(stage) === 'active',
              'border-bronze text-bronze': stageState(stage) === 'failed',
              'border-line-strong text-subtle': stageState(stage) === 'pending',
            }"
            aria-hidden="true"
            >{{ stageState(stage) === 'done' ? '✓' : stageState(stage) === 'failed' ? '!' : i + 1 }}</span
          >
          <span :class="stageState(stage) === 'pending' ? 'text-subtle' : 'text-fg'"
            >{{ STAGE_TEXT[stage] }}<span v-if="plies[stage]" class="tabular text-subtle" :data-testid="`plies-${stage}`"> · {{ plies[stage] }} plies</span></span
          >
        </li>
      </ol>
    </div>

    <div v-if="result && !result.outcome.ok" class="mt-5 rounded-xl border border-bronze-line bg-bronze-soft p-4 text-sm" role="alert" data-testid="import-rejected">
      <p class="font-semibold">Not published — failed at “{{ STAGE_TEXT[result.outcome.stage] }}”. Nothing was stored.</p>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li v-for="reason in result.outcome.reasons" :key="reason" class="whitespace-pre-wrap">{{ reason }}</li>
      </ul>
      <p v-if="result.outcome.sha256" class="mt-2 font-mono text-xs text-muted">SHA-256 {{ result.outcome.sha256 }}</p>
    </div>

    <div v-if="result && result.outcome.ok" class="mt-5 grid gap-5 lg:grid-cols-[1fr_auto]" data-testid="import-admitted">
      <div>
        <p class="font-semibold text-accent">
          {{ result.reused ? 'Already published — this exact file is in the Arena catalog.' : 'Passed every check and published to the Arena.' }}
        </p>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-subtle">Title</dt>
          <dd data-testid="import-title">{{ result.outcome.metadata.title }}</dd>
          <dt class="text-subtle">Model</dt>
          <dd>{{ result.outcome.metadata.model }}</dd>
          <dt class="text-subtle">Code agent</dt>
          <dd>{{ result.outcome.metadata.codeAgent }}</dd>
          <template v-if="result.outcome.metadata.modelPlatform">
            <dt class="text-subtle">Model platform</dt>
            <dd>{{ result.outcome.metadata.modelPlatform }}</dd>
          </template>
          <dt class="text-subtle">GitHub</dt>
          <dd><a :href="result.outcome.metadata.githubUrl" target="_blank" rel="noreferrer noopener" class="text-accent underline underline-offset-2 break-all">{{ result.outcome.metadata.githubUrl }}</a></dd>
          <dt class="text-subtle">Game version</dt>
          <dd>{{ result.outcome.metadata.gameVersion }}</dd>
          <dt class="text-subtle">Runtime</dt>
          <dd>{{ result.outcome.metadata.runtime }}</dd>
          <dt class="text-subtle">Rules</dt>
          <dd><span class="font-semibold text-accent">Compatible</span> · {{ result.outcome.metadata.rulesId }}</dd>
          <dt class="text-subtle">SHA-256</dt>
          <dd class="font-mono text-xs" :title="result.outcome.sha256">{{ shortHash(result.outcome.sha256) }}</dd>
        </dl>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" :class="BTN.secondary" data-testid="use-left" @click="useIn('left')">Play in left seat</button>
          <button type="button" :class="BTN.secondary" data-testid="use-right" @click="useIn('right')">Play in right seat</button>
        </div>
      </div>
      <figure class="flex gap-3">
        <canvas ref="preview0" width="448" height="576" class="w-28 rounded-md border border-line" role="img" aria-label="Opening frame drawn by the imported program" />
        <canvas ref="preview1" width="448" height="576" class="w-28 rounded-md border border-line" role="img" aria-label="Flipped opening frame drawn by the imported program" />
      </figure>
    </div>
  </section>
</template>
