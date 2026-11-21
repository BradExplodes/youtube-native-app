<script lang="ts">
  // Short messages above the player bar.
  import { CircleAlert, CircleCheck } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { toasts } from "$lib/stores/toast.svelte";
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <button class="toast" class:error={t.error} transition:fly={{ y: 12, duration: 180 }} onclick={() => toasts.dismiss(t.id)}>
      {#if t.error}<CircleAlert size={16} />{:else}<CircleCheck size={16} />{/if}
      <span>{t.text}</span>
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(var(--player) + var(--player-gap) * 2 + 10px);
    z-index: 70;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, calc(100vw - 48px));
    padding: 10px 16px;
    border-radius: 999px;
    background: var(--text);
    color: var(--bg);
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 12px 34px rgb(0 0 0 / 0.5);
    pointer-events: auto;
  }
  .toast :global(svg) {
    flex: none;
    color: #1f9d55;
  }
  .toast.error {
    background: #3a1513;
    color: #ffd9d6;
    border: 1px solid rgb(255 65 54 / 0.35);
  }
  .toast.error :global(svg) {
    color: var(--accent);
  }
</style>
