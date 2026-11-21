<script lang="ts">
  // The keyboard shortcuts popup (`?`).
  import Modal from "./Modal.svelte";
  import ShortcutList from "./ShortcutList.svelte";
  import { ui } from "$lib/stores/ui.svelte";

  const close = () => (ui.shortcutsOpen = false);
</script>

{#if ui.shortcutsOpen}
  <Modal label="Keyboard shortcuts" width={880} height={680} onclose={close}>
    <header class="head">
      <div>
        <div class="eyebrow">Help</div>
        <h2>Keyboard shortcuts</h2>
      </div>
      <button class="modal-pill" onclick={close}>Close</button>
    </header>
    <div class="scroll">
      <ShortcutList />
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
  h2 {
    margin: 4px 0 0;
    font-size: 24px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 26px 26px;
  }
</style>
