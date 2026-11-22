<script lang="ts">
  // Popups that ask for something: a playlist's details (new or edit), or "are you sure?".
  import { Globe, Link2, Lock } from "@lucide/svelte";
  import Modal from "./Modal.svelte";
  import { createPlaylist, updatePlaylist } from "$lib/actions";
  import { dialog, type Dialog } from "$lib/stores/dialog.svelte";
  import { nav } from "$lib/stores/nav.svelte";
  import type { Privacy } from "$lib/ytm/types";

  const d = $derived(dialog.current);

  const PRIVACY: { id: Privacy; label: string; hint: string; icon: typeof Lock }[] = [
    { id: "PRIVATE", label: "Private", hint: "Only you can see it", icon: Lock },
    { id: "UNLISTED", label: "Unlisted", hint: "Anyone with the link", icon: Link2 },
    { id: "PUBLIC", label: "Public", hint: "Anyone can find it", icon: Globe },
  ];

  // The form's own copy, filled in whenever a playlist popup opens.
  let title = $state("");
  let description = $state("");
  let privacy = $state<Privacy>("PRIVATE");
  let busy = $state(false);
  let titleInput = $state<HTMLInputElement>();
  $effect(() => {
    if (d?.kind !== "playlist") return;
    title = d.title;
    description = d.description;
    privacy = d.privacy;
    busy = false;
    queueMicrotask(() => titleInput?.select());
  });

  async function save(p: Extract<Dialog, { kind: "playlist" }>) {
    const details = { title: title.trim(), description: description.trim(), privacy };
    if (!details.title || busy) return;
    busy = true;
    if (p.browseId) {
      const ok = await updatePlaylist(p.browseId, details, p);
      busy = false;
      if (ok) dialog.close();
    } else {
      const songs = (p.videoIds ?? []).map((videoId) => ({ videoId, title: "" }));
      const id = await createPlaylist(details, songs);
      busy = false;
      if (id) {
        dialog.close();
        // A playlist made from nothing: open it. One made from a song: stay where you are.
        if (!songs.length) nav.go({ kind: "list", browseId: id });
      }
    }
  }

  async function confirm(c: Extract<Dialog, { kind: "confirm" }>) {
    if (busy) return;
    busy = true;
    await c.onconfirm();
    busy = false;
    dialog.close();
  }
</script>

{#if d?.kind === "playlist"}
  <Modal label={d.browseId ? "Edit playlist" : "New playlist"} width={520} onclose={() => dialog.close()}>
    <form
      class="body"
      onsubmit={(e) => {
        e.preventDefault();
        save(d);
      }}
    >
      <header class="top">
        <div>
          <div class="eyebrow">{d.browseId ? "Edit playlist" : "New playlist"}</div>
          <h2>{d.browseId ? "Playlist details" : (d.videoIds?.length ?? 0) > 1 ? "Save as a playlist" : d.videoIds?.length ? "Create with this song" : "Create a playlist"}</h2>
        </div>
        <button type="button" class="modal-pill" onclick={() => dialog.close()}>Close</button>
      </header>

      <label class="field">
        <span class="eyebrow">Title</span>
        <input bind:this={titleInput} bind:value={title} maxlength="150" placeholder="My playlist" spellcheck="false" />
      </label>
      <label class="field">
        <span class="eyebrow">Description</span>
        <textarea bind:value={description} rows="3" maxlength="5000" placeholder="Optional"></textarea>
      </label>

      <div class="field">
        <span class="eyebrow">Privacy</span>
        <div class="privacy" role="radiogroup" aria-label="Privacy">
          {#each PRIVACY as p (p.id)}
            {@const Icon = p.icon}
            <button type="button" role="radio" aria-checked={privacy === p.id} class:on={privacy === p.id} onclick={() => (privacy = p.id)}>
              <Icon size={16} />
              <span class="p-label">{p.label}</span>
              <span class="p-hint">{p.hint}</span>
            </button>
          {/each}
        </div>
      </div>

      <footer>
        <button type="button" class="btn-ghost" onclick={() => dialog.close()}>Cancel</button>
        <button type="submit" class="btn-primary" disabled={!title.trim() || busy}>
          {busy ? "Saving…" : d.browseId ? "Save" : "Create"}
        </button>
      </footer>
    </form>
  </Modal>
{:else if d?.kind === "confirm"}
  <Modal label={d.title} width={440} onclose={() => dialog.close()}>
    <div class="body">
      <h2>{d.title}</h2>
      <p class="message">{d.message}</p>
      <footer>
        <button class="btn-ghost" onclick={() => dialog.close()}>Cancel</button>
        <button class="btn-primary" class:danger={d.danger ?? true} disabled={busy} onclick={() => confirm(d)}>{busy ? "Working…" : d.confirm}</button>
      </footer>
    </div>
  </Modal>
{/if}

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 24px;
  }
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 4px 0 0;
    font-size: 22px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  .message {
    margin: -6px 0 0;
    color: var(--muted);
    line-height: 1.55;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  input,
  textarea {
    width: 100%;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.04);
    border: 1px solid var(--line-strong);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    outline: none;
    resize: none;
    user-select: text;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  input:focus,
  textarea:focus {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  input::placeholder,
  textarea::placeholder {
    color: var(--faint);
  }
  .privacy {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .privacy button {
    display: grid;
    justify-items: start;
    gap: 2px;
    padding: 12px;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.02);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    text-align: left;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .privacy button:hover {
    background: rgb(255 255 255 / 0.05);
  }
  .privacy button.on {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    background: var(--accent-soft);
    color: var(--text);
  }
  .p-label {
    margin-top: 6px;
    font-weight: 600;
    font-size: 13px;
  }
  .p-hint {
    font-size: 11.5px;
    color: var(--muted);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
  }
  footer .btn-primary {
    height: 40px;
    padding: 0 22px;
  }
  .btn-ghost {
    height: 40px;
    padding: 0 18px;
    border-radius: 999px;
    color: var(--muted);
    font-weight: 500;
  }
  .btn-ghost:hover {
    color: var(--text);
    background: rgb(255 255 255 / 0.06);
  }
  .btn-primary.danger {
    background: #d9322a;
  }
  .btn-primary.danger:hover:not(:disabled) {
    background: #e8463e;
  }
</style>
