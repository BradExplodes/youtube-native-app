<script lang="ts">
  // Other versions of a song (see stores/versions.svelte.ts), with chips to narrow them
  // to one kind: sped up, slowed, nightcore, live…
  import Modal from "./Modal.svelte";
  import SongRows from "./SongRows.svelte";
  import { playSingle } from "$lib/open";
  import { KINDS, kindsOf, versions } from "$lib/stores/versions.svelte";
  import type { Track } from "$lib/ytm/types";

  const song = $derived(versions.song);
  let kind = $state<string | null>(null);
  $effect(() => {
    void song;
    kind = null;
  });

  const all = $derived([...versions.performances, ...versions.uploads]);
  // Only offer chips for kinds that are actually there.
  const present = $derived(KINDS.filter((k) => all.some((t) => kindsOf(t).includes(k.id))));
  const pick = (list: Track[]) => (kind ? list.filter((t) => kindsOf(t).includes(kind!)) : list);
  const performances = $derived(pick(versions.performances));
  const uploads = $derived(pick(versions.uploads));

  const play = (list: Track[]) => (i: number) => {
    const t = list[i];
    if (t) playSingle(t.videoId);
  };
</script>

{#if song}
  <Modal label="Other versions of {song.title}" width={860} height={720} onclose={() => versions.close()}>
    <header class="head">
      <div class="titles">
        <div class="eyebrow">Other versions</div>
        <h2 class="truncate">{song.title}</h2>
        {#if song.artist}<div class="artist truncate">{song.artist}</div>{/if}
      </div>
      <button class="modal-pill" onclick={() => versions.close()}>Close</button>
    </header>

    {#if present.length}
      <div class="chips" role="tablist">
        <button role="tab" class="chip" class:on={!kind} aria-selected={!kind} onclick={() => (kind = null)}>All</button>
        {#each present as k (k.id)}
          <button role="tab" class="chip" class:on={kind === k.id} aria-selected={kind === k.id} onclick={() => (kind = k.id)}>
            {k.label}
          </button>
        {/each}
      </div>
    {/if}

    <div class="scroll">
      {#if versions.loading}
        <p class="note">Looking for other versions…</p>
      {:else if versions.error}
        <p class="note">Couldn't look for other versions: {versions.error}</p>
      {:else if !all.length}
        <p class="note">No other versions found.</p>
      {:else}
        {#if performances.length}
          <section>
            <h3>Other performances <span class="from">from YouTube Music</span></h3>
            <SongRows tracks={performances} play={play(performances)} />
          </section>
        {/if}
        {#if uploads.length}
          <section>
            <h3>Remixes, edits and covers</h3>
            <SongRows tracks={uploads} play={play(uploads)} />
          </section>
        {/if}
        {#if !performances.length && !uploads.length}
          <p class="note">None of that kind.</p>
        {/if}
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 22px 22px 12px 26px;
  }
  .titles {
    min-width: 0;
  }
  h2 {
    margin: 4px 0 0;
    font-size: 24px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  .artist {
    color: var(--muted);
    font-size: 13px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 26px 14px;
    border-bottom: 1px solid var(--line);
  }
  .chip {
    height: 30px;
    padding: 0 14px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.04);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 500;
  }
  .chip:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .chip.on {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 20px 24px;
  }
  section {
    margin-bottom: 26px;
  }
  h3 {
    margin: 0 6px 10px;
    font-size: 16px;
    font-weight: 600;
  }
  .from {
    margin-left: 6px;
    color: var(--faint);
    font-size: 12px;
    font-weight: 500;
  }
  .note {
    margin: 8px 6px;
    color: var(--muted);
  }
</style>
