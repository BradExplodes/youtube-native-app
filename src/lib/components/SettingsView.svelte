<script lang="ts">
  // The Settings page: playback, integrations, accessibility, shortcuts, troubleshooting, about.
  import { Copy, Download, FolderOpen, RefreshCw } from "@lucide/svelte";
  import ShortcutList from "./ShortcutList.svelte";
  import { openLogFolder, type AppSettings } from "$lib/ipc";
  import { settings } from "$lib/stores/settings.svelte";
  import { toasts } from "$lib/stores/toast.svelte";
  import { updates } from "$lib/stores/updates.svelte";

  $effect(() => {
    settings.load();
  });

  const app = $derived(settings.app);
  const info = $derived(settings.info);

  interface Toggle {
    key: keyof AppSettings;
    label: string;
    help: string;
  }
  const PLAYBACK: Toggle[] = [
    {
      key: "audioOnly",
      label: "Audio only",
      help: "Play the song version of tracks rather than the music video, and keep any video at the lowest quality. Uses less data, CPU and memory.",
    },
  ];
  const INTEGRATIONS: Toggle[] = [
    {
      key: "discordPresence",
      label: "Show what you're listening to on Discord",
      help: "\"Listening to…\" on your Discord profile while music plays. Needs the Discord app running on this computer.",
    },
  ];
  const UPDATES: Toggle[] = [
    {
      key: "checkForUpdates",
      label: "Check for updates automatically",
      help: "Look for a new version on GitHub each time the app starts, and offer to install it.",
    },
  ];
  const TROUBLESHOOTING: Toggle[] = [
    {
      key: "verboseLogs",
      label: "Detailed logging",
      help: "Write more detail to the log file (including song titles), to help track down a problem. Turn it off again afterwards.",
    },
  ];

  async function openLogs() {
    try {
      await openLogFolder();
    } catch (e) {
      toasts.error(`Couldn't open the log folder: ${e}`);
    }
  }

  async function copyDiagnostics() {
    if (!info || !app) return;
    const text = [
      `${info.name} ${info.version}${info.debug ? " (development build)" : ""}`,
      `Windows: ${info.os}`,
      `WebView2: ${info.webview}`,
      `Tauri: ${info.tauri}`,
      `Settings: ${JSON.stringify(app)}`,
      `Logs: ${info.logDir}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toasts.show("Diagnostic info copied");
    } catch {
      toasts.error("Couldn't copy the diagnostic info");
    }
  }
</script>

{#snippet toggles(items: Toggle[])}
  {#each items as t (t.key)}
    {@const on = !!app?.[t.key]}
    <div class="setting">
      <div class="text">
        <div class="label" id="label-{t.key}">{t.label}</div>
        <div class="help" id="help-{t.key}">{t.help}</div>
      </div>
      <button
        class="switch"
        class:on
        role="switch"
        aria-checked={on}
        aria-labelledby="label-{t.key}"
        aria-describedby="help-{t.key}"
        disabled={!app}
        onclick={() => settings.set(t.key, !on)}
      >
        <span class="knob"></span>
      </button>
    </div>
  {/each}
{/snippet}

<div class="view">
  <header>
    <div class="eyebrow">App</div>
    <h1>Settings</h1>
  </header>

  <section aria-labelledby="h-playback">
    <h2 id="h-playback">Playback</h2>
    {@render toggles(PLAYBACK)}
  </section>

  <section aria-labelledby="h-integrations">
    <h2 id="h-integrations">Integrations</h2>
    {@render toggles(INTEGRATIONS)}
  </section>

  <section aria-labelledby="h-a11y">
    <h2 id="h-a11y">Accessibility</h2>
    <div class="setting">
      <div class="text">
        <div class="label" id="label-motion">Reduce motion</div>
        <div class="help" id="help-motion">
          Turn off animations and transitions. (They're already off when Windows' "Animation effects" is off.)
        </div>
      </div>
      <button
        class="switch"
        class:on={settings.reduceMotion}
        role="switch"
        aria-checked={settings.reduceMotion}
        aria-labelledby="label-motion"
        aria-describedby="help-motion"
        onclick={() => settings.setReduceMotion(!settings.reduceMotion)}
      >
        <span class="knob"></span>
      </button>
    </div>
    <p class="note">Ctrl + plus / minus zooms the whole app in and out, and Ctrl + 0 resets it.</p>
  </section>

  <section aria-labelledby="h-keys">
    <h2 id="h-keys">Keyboard shortcuts</h2>
    <p class="note">Press <kbd>?</kbd> anywhere to see these.</p>
    <ShortcutList />
  </section>

  <section aria-labelledby="h-updates">
    <h2 id="h-updates">Updates</h2>
    {@render toggles(UPDATES)}
    <div class="actions">
      {#if updates.status === "available" && updates.available}
        <button class="modal-pill" onclick={() => updates.offer()} disabled={!updates.canInstall}>
          <Download size={15} /> Install version {updates.available.version}
        </button>
      {:else}
        <button
          class="modal-pill"
          onclick={() => updates.check()}
          disabled={updates.status === "checking" || updates.status === "installing"}
        >
          <RefreshCw size={15} /> Check for updates
        </button>
      {/if}
    </div>
    <p class="note" role="status">
      {#if updates.status === "checking"}
        Checking…
      {:else if updates.status === "current"}
        You're on the latest version.
      {:else if updates.status === "available" && updates.available}
        Version {updates.available.version} is available.{updates.canInstall
          ? ""
          : " Updates install only in the installed app, not a development build."}
      {:else if updates.status === "installing"}
        Downloading update{updates.progress != null ? ` (${Math.round(updates.progress * 100)}%)` : ""}…
      {:else if updates.status === "error"}
        Couldn't check for updates. Check your internet connection and try again.
      {/if}
    </p>
  </section>

  <section aria-labelledby="h-trouble">
    <h2 id="h-trouble">Troubleshooting</h2>
    {@render toggles(TROUBLESHOOTING)}
    <div class="actions">
      <button class="modal-pill" onclick={openLogs}><FolderOpen size={15} /> Open log folder</button>
      <button class="modal-pill" onclick={copyDiagnostics} disabled={!info}><Copy size={15} /> Copy diagnostic info</button>
    </div>
  </section>

  <section aria-labelledby="h-about">
    <h2 id="h-about">About</h2>
    {#if info}
      <dl class="facts">
        <dt>Version</dt>
        <dd>{info.version}{info.debug ? " (development build)" : ""}</dd>
        <dt>WebView2</dt>
        <dd>{info.webview}</dd>
        <dt>Tauri</dt>
        <dd>{info.tauri}</dd>
        <dt>Log files</dt>
        <dd class="path">{info.logDir}</dd>
        <dt>App data</dt>
        <dd class="path">{info.dataDir}</dd>
      </dl>
    {:else}
      <p class="note">Loading…</p>
    {/if}
  </section>
</div>

<style>
  .view {
    height: 100%;
    overflow-y: auto;
    padding: 48px 40px var(--player-clearance);
  }
  header {
    margin-bottom: 20px;
  }
  h1 {
    margin: 8px 0 0;
    font-size: 44px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  section {
    max-width: 920px;
    padding: 24px 0 8px;
    border-top: 1px solid var(--line);
  }
  section + section {
    margin-top: 12px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 18px;
    font-weight: 600;
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
    padding: 12px 0;
  }
  .text {
    min-width: 0;
    max-width: 640px;
  }
  .label {
    font-weight: 500;
  }
  .help,
  .note {
    margin-top: 2px;
    color: var(--muted);
    font-size: 13px;
  }
  .note {
    margin: 4px 0 14px;
  }

  /* An on/off switch. */
  .switch {
    position: relative;
    flex: none;
    width: 44px;
    height: 24px;
    border-radius: 999px;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    transition: background 0.15s;
  }
  .switch .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--muted);
    transition:
      transform 0.18s var(--ease),
      background 0.15s;
  }
  .switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch.on .knob {
    transform: translateX(20px);
    background: var(--accent-ink);
  }
  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 0 16px;
  }
  .actions .modal-pill:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 8px 24px;
    margin: 0 0 16px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    user-select: text;
  }
  .path {
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
</style>
