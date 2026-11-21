<script lang="ts" module>
  export type ArtKind = "album" | "playlist" | "artist" | "song" | "video";
</script>

<script lang="ts">
  // Cover art that fills its box, with a placeholder when there's no image (or it fails
  // to load): a soft gradient and an icon for what kind of thing it is.
  import { Disc3, ListMusic, MicVocal, Music, Clapperboard } from "@lucide/svelte";

  interface Props {
    src?: string | null;
    kind?: ArtKind;
    /** Icon size in px; by default it scales with the box. */
    icon?: number;
    lazy?: boolean;
  }
  let { src, kind = "song", icon, lazy = false }: Props = $props();

  const ICONS = { album: Disc3, playlist: ListMusic, artist: MicVocal, song: Music, video: Clapperboard };
  const Icon = $derived(ICONS[kind]);

  let failed = $state<string | null>(null);
  const show = $derived(!!src && failed !== src);
</script>

<span class="artwork" class:empty={!show}>
  {#if show}
    <img {src} alt="" loading={lazy ? "lazy" : undefined} decoding="async" draggable="false" onerror={() => (failed = src ?? null)} />
  {:else}
    <span class="icon" style:--icon={icon ? `${icon}px` : undefined}>
      <Icon size="100%" strokeWidth={1.6} />
    </span>
  {/if}
</span>

<style>
  .artwork {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    container-type: size;
    overflow: hidden;
    border-radius: inherit;
  }
  .artwork.empty {
    background:
      radial-gradient(120% 90% at 20% 10%, rgb(255 255 255 / 0.07), transparent 60%),
      linear-gradient(145deg, var(--surface-3), var(--surface-2));
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .icon {
    display: grid;
    width: var(--icon, clamp(14px, 38cqmin, 72px));
    height: var(--icon, clamp(14px, 38cqmin, 72px));
    color: var(--faint);
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
