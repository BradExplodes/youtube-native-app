<script lang="ts">
  // The right-click menu (see stores/menu.svelte.ts). Stays inside the window, opens
  // submenus to the side, and closes on a click elsewhere, Escape, scrolling or resizing.
  import { Check, ChevronRight } from "@lucide/svelte";
  import { tick } from "svelte";
  import { fade } from "svelte/transition";
  import { entriesOf, menu, type MenuEntry, type MenuItem } from "$lib/stores/menu.svelte";

  const PAD = 8;
  const open = $derived(menu.open);

  let root = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  /** The open submenu: which item it belongs to, and where it goes. */
  let sub = $state<{ index: number; x: number; y: number; owner: MenuItem } | null>(null);
  let subEl = $state<HTMLDivElement>();
  let subTimer: ReturnType<typeof setTimeout> | undefined;

  // Place the menu at the pointer, flipped back inside the window if it would spill out.
  $effect(() => {
    if (!open) return;
    sub = null;
    pos = { x: open.x, y: open.y };
    tick().then(() => {
      if (!root) return;
      const r = root.getBoundingClientRect();
      pos = {
        x: Math.max(PAD, Math.min(open.x, innerWidth - r.width - PAD)),
        y: Math.max(PAD, open.y + r.height > innerHeight - PAD ? open.y - r.height : open.y),
      };
      root.focus();
    });
  });

  function openSub(index: number, item: MenuItem, el: HTMLElement) {
    clearTimeout(subTimer);
    if (sub?.index === index) return;
    const r = el.getBoundingClientRect();
    sub = { index, x: r.right + 4, y: r.top - 6, owner: item };
    tick().then(() => {
      if (!subEl || !sub) return;
      const s = subEl.getBoundingClientRect();
      const x = s.right > innerWidth - PAD ? r.left - s.width - 4 : sub.x;
      const y = Math.max(PAD, Math.min(sub.y, innerHeight - s.height - PAD));
      sub = { ...sub, x, y };
    });
  }

  function hover(index: number, item: MenuItem, el: HTMLElement) {
    clearTimeout(subTimer);
    if (item.items) openSub(index, item, el);
    else if (sub) subTimer = setTimeout(() => (sub = null), 180);
  }

  function run(item: MenuItem) {
    if (item.disabled || item.items) return;
    if (!item.keepOpen) menu.close();
    item.action?.();
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      // Handled before any popup underneath sees it, so only the menu closes.
      e.preventDefault();
      e.stopPropagation();
      if (sub) sub = null;
      else menu.close();
      return;
    }
    // Up/down move between items; right opens a submenu, left closes it.
    const inSub = !!sub && !!subEl?.contains(document.activeElement);
    const list = inSub ? subEl : root;
    const buttons = [...(list?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "ArrowRight" && !inSub && at >= 0) {
      buttons[at].dispatchEvent(new MouseEvent("mouseenter"));
      tick().then(() => tick()).then(() => subEl?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    } else if (e.key === "ArrowLeft" && inSub) {
      const owner = root?.querySelector<HTMLButtonElement>(`[data-index="${sub?.index}"]`);
      sub = null;
      owner?.focus();
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (root?.contains(t) || subEl?.contains(t)) return;
    menu.close();
  }

  const close = () => open && menu.close();
</script>

<svelte:window
  onkeydowncapture={onKey}
  onpointerdowncapture={onPointerDown}
  onresize={close}
  onblur={close}
  onwheelcapture={(e) => {
    const t = e.target as Node;
    if (!root?.contains(t) && !subEl?.contains(t)) close();
  }}
/>

{#snippet list(entries: MenuEntry[], top: boolean)}
  {#each entries as entry, i (i)}
    {#if entry === null}
      <div class="sep" role="separator"></div>
    {:else}
      {@const Icon = entry.icon}
      <button
        role="menuitem"
        class="item"
        class:danger={entry.danger}
        class:checked={entry.checked}
        class:open={top && sub?.index === i}
        disabled={entry.disabled}
        data-index={i}
        aria-haspopup={entry.items ? "menu" : undefined}
        onmouseenter={(e) => top && hover(i, entry, e.currentTarget)}
        onclick={(e) => (entry.items ? openSub(i, entry, e.currentTarget) : run(entry))}
      >
        <span class="icon">
          {#if entry.checked}<Check size={16} />{:else if Icon}<Icon size={16} />{/if}
        </span>
        <span class="label truncate">{entry.label}</span>
        {#if entry.items}<ChevronRight size={15} class="chev" />{/if}
      </button>
    {/if}
  {/each}
{/snippet}

{#if open}
  <div
    bind:this={root}
    class="menu"
    role="menu"
    tabindex="-1"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    in:fade={{ duration: 90 }}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {@render list(open.items, true)}
  </div>
  {#if sub}
    <div
      bind:this={subEl}
      class="menu sub"
      role="menu"
      tabindex="-1"
      style:left="{sub.x}px"
      style:top="{sub.y}px"
      onmouseenter={() => clearTimeout(subTimer)}
      oncontextmenu={(e) => e.preventDefault()}
    >
      {@render list(entriesOf(sub.owner.items), false)}
    </div>
  {/if}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 60;
    min-width: 220px;
    max-width: 300px;
    padding: 6px;
    border-radius: 14px;
    background: var(--modal-bg);
    border: 1px solid rgb(255 255 255 / 0.09);
    box-shadow:
      0 18px 50px rgb(0 0 0 / 0.6),
      inset 0 1px 0 rgb(255 255 255 / 0.04);
    outline: none;
  }
  .menu.sub {
    max-height: min(420px, calc(100vh - 16px));
    overflow-y: auto;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border-radius: 9px;
    color: var(--text);
    font-size: 13px;
    text-align: left;
  }
  .item:hover:not(:disabled),
  .item:focus-visible,
  .item.open {
    background: rgb(255 255 255 / 0.07);
    outline: none;
  }
  .item:disabled {
    color: var(--faint);
    cursor: default;
  }
  .item.checked .icon {
    color: var(--accent);
  }
  .item.danger {
    color: #ff6b62;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 18px;
    flex: none;
    color: var(--muted);
  }
  .danger .icon {
    color: inherit;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .item :global(.chev) {
    color: var(--muted);
    flex: none;
  }
  .sep {
    height: 1px;
    margin: 5px 8px;
    background: var(--line-strong);
  }
</style>
