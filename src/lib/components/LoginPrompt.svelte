<script lang="ts">
  import { showLogin } from "$lib/ipc";
  let opened = $state(false);
</script>

<!-- Sits below the title bar, so the window can still be moved and closed. -->
<div class="overlay">
  <div class="glow"></div>
  <div class="modal-card card">
    <img class="mark" src="/logo.png" alt="" width="64" height="64" draggable="false" />
    <h1>Sign in to YouTube Music</h1>
    <p>
      A YouTube window will open. It may first ask about cookies (pick whichever you like), then
      Google sign-in. Once you're signed in it closes by itself, and you only need to do this once.
    </p>
    <button
      class="btn-primary"
      onclick={async () => {
        opened = true;
        await showLogin();
      }}
    >
      {opened ? "Open sign-in window again" : "Sign in"}
    </button>
    {#if opened}
      <p class="eyebrow hint">Waiting for you to finish signing in…</p>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: var(--titlebar) 0 0 0;
    z-index: 30;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--bg);
  }
  .glow {
    position: absolute;
    width: 720px;
    height: 720px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent-glow), transparent 65%);
    opacity: 0.6;
  }
  .card {
    align-items: center;
    width: min(440px, calc(100% - 32px));
    padding: 36px 32px 32px;
    text-align: center;
  }
  .mark {
    display: block;
    width: 64px;
    height: 64px;
    margin: 0 auto 20px;
    filter: drop-shadow(0 0 24px var(--accent-glow));
  }
  h1 {
    margin: 0 0 10px;
    font-size: 24px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  p {
    margin: 0 0 24px;
    color: var(--muted);
    line-height: 1.55;
  }
  .hint {
    margin: 18px 0 0;
  }
</style>
