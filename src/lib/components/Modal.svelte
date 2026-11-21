<script lang="ts" module>
  // Popups can stack (other versions opened from search): Escape closes the top one only.
  const stack: symbol[] = [];
</script>

<script lang="ts">
  // A popup over the app: a dimmed, blurred backdrop and a floating card. Escape or a click
  // outside closes it. Shared look for every popup (see the .modal-* classes in app.css).
  import type { Snippet } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  interface Props {
    onclose: () => void;
    /** Accessible name for the dialog. */
    label: string;
    /** Card width in px (it shrinks to fit smaller windows). */
    width?: number;
    /** Fixed card height in px, for popups whose content scrolls inside; otherwise it fits its content. */
    height?: number;
    children: Snippet;
  }
  let { onclose, label, width = 720, height, children }: Props = $props();

  let card = $state<HTMLDivElement>();
  const me = Symbol();
  $effect(() => {
    stack.push(me);
    return () => {
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
    };
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && stack[stack.length - 1] === me) {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }

  // Keep the keyboard focus inside the popup, and give it back when the popup closes.
  $effect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (card && !card.contains(document.activeElement)) card.focus();
    return () => before?.focus?.();
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" transition:fade={{ duration: 160 }} onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div
    bind:this={card}
    class="modal-card"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    style:width="min({width}px, 100% - 48px)"
    style:height={height ? `min(${height}px, 100% - 48px)` : undefined}
    transition:scale={{ start: 0.96, duration: 200, easing: cubicOut }}
  >
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: var(--titlebar) 0 0 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.55);
    backdrop-filter: blur(6px);
  }
  .modal-card {
    max-height: calc(100% - 48px);
    outline: none;
  }
</style>
