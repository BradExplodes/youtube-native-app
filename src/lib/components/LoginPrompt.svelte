<script lang="ts">
  import { showLogin } from "$lib/ipc";
  let opened = $state(false);
</script>

<div class="overlay">
  <div class="card">
    <h1>Sign in to YouTube Music</h1>
    <p>
      A YouTube window will open. It may first ask about cookies (pick whichever you like), then
      Google sign-in. Once you're signed in it closes by itself, and you only need to do this
      once.
    </p>
    <button
      class="primary"
      onclick={async () => {
        opened = true;
        await showLogin();
      }}
    >
      {opened ? "Open sign-in window again" : "Sign in"}
    </button>
    {#if opened}
      <p class="hint">Waiting for you to finish signing in…</p>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    z-index: 10;
  }
  .card {
    width: min(420px, calc(100% - 32px));
    padding: 28px;
    border-radius: var(--radius);
    background: var(--panel);
    border: 1px solid var(--line);
    text-align: center;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 8px;
  }
  p {
    color: var(--muted);
    line-height: 1.5;
    margin: 0 0 20px;
  }
  .primary {
    padding: 10px 28px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .hint {
    margin: 16px 0 0;
    font-size: 12px;
  }
</style>
