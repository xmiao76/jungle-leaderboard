<script setup lang="ts">
import { sdkUrl } from '../app/paths';
import { MAX_UPLOAD_BYTES } from '../loader/limits';
import { RULES_DIGEST, RULES_ID } from '../referee';
import { SECTION_TITLE } from '../ui/classes';
</script>

<template>
  <section id="how-upload-works" class="mt-16" aria-labelledby="about-upload-title">
    <h2 id="about-upload-title" :class="[SECTION_TITLE, 'border-b border-line-strong pb-3']">How uploading works</h2>
    <div class="mt-6 grid gap-8 text-sm leading-relaxed text-muted lg:grid-cols-2">
      <div class="space-y-4">
        <h3 class="font-display text-lg font-semibold text-fg">Two catalogs</h3>
        <p>
          Every upload is <span class="font-semibold text-fg">published</span>: checked here, tested in two games against the
          reference program, then added to the shared catalog for everyone, starting at an Elo rating of 1000. If any step fails,
          nothing is stored. The same bytes again reuse the entry; a changed build is a new entry even if its title and version are
          the same. <span class="font-semibold text-fg">On this device</span> only lists programs imported before publishing
          existed; they still play, but only in friendly (unrated) matches.
        </p>
        <p>
          The <span class="font-semibold text-fg">public catalog</span> is the Arena’s shared database: every program in it is stored
          under its SHA-256 and listed with that hash, and every download is verified against it. A maintainer adds programs with
          <code class="font-mono text-xs">npm run catalog:add -- path/to/file.wasm</code>, which runs the same checks; one of them is the
          reference program that every upload test and conformance run plays against.
        </p>
      </div>
      <div class="space-y-4">
        <h3 class="font-display text-lg font-semibold text-fg">What the checks cover</h3>
        <p>
          Before any of your code runs: size (≤ {{ MAX_UPLOAD_BYTES / 1048576 }} MiB), that the file is a component, its hash, and that it imports
          only <code class="font-mono text-xs">jungle:arena/display@1.0.0</code> and exports <code class="font-mono text-xs">jungle:arena/game@1.0.0</code>
          with exactly the contract’s types. Then, on a throwaway instance: metadata (rules ID and digest
          <span class="font-mono text-xs break-all">{{ RULES_DIGEST.slice(0, 16) }}…</span> must match), start-up, one legal move and two 448×576 frames.
        </p>
        <p>
          Build against <a :href="sdkUrl('jungle.wit')" class="text-accent underline underline-offset-2">jungle.wit</a> and the
          <a :href="sdkUrl(`${RULES_ID}.json`)" class="text-accent underline underline-offset-2">rules profile</a>; any language that can
          produce a WebAssembly Component works.
        </p>
      </div>
    </div>
  </section>
</template>
