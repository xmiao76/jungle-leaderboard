<script setup lang="ts">
import { sdkUrl } from '../app/paths';
import { MAX_UPLOAD_BYTES } from '../loader/limits';
import { RULES_DIGEST } from '../referee';
import { SECTION_TITLE } from '../ui/classes';
</script>

<template>
  <section id="how-upload-works" class="mt-16" aria-labelledby="about-upload-title">
    <h2 id="about-upload-title" :class="[SECTION_TITLE, 'border-b border-line-strong pb-3']">How uploading works</h2>
    <div class="mt-6 grid gap-8 text-sm leading-relaxed text-muted lg:grid-cols-2">
      <div class="space-y-4">
        <h3 class="font-display text-lg font-semibold text-fg">Two catalogs</h3>
        <p>
          <span class="font-semibold text-fg">On this device</span> holds the files you upload. They are checked, saved in this browser
          by SHA-256 and usable at once — but only here. Uploading the same bytes again reuses the entry; a changed build is a new entry
          even if its title and version are the same. Clearing site data removes them.
        </p>
        <p>
          The <span class="font-semibold text-fg">public catalog</span> is part of the site itself: binaries committed to the repository
          and listed in <code class="font-mono text-xs">catalog/manifest.json</code> with their hashes. A maintainer adds one with
          <code class="font-mono text-xs">npm run catalog:add -- path/to/file.wasm</code>, which runs the same checks, and it appears for
          everyone after the next deployment. Every download is verified against its manifest hash. A shared catalog where any visitor’s
          upload is published instantly would need a storage service beyond this static site, so it is deliberately not offered.
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
          <a :href="sdkUrl('desktop-jungle-v1.json')" class="text-accent underline underline-offset-2">rules profile</a>; any language that can
          produce a WebAssembly Component works.
        </p>
      </div>
    </div>
  </section>
</template>
