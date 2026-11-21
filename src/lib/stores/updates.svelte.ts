// New versions of the app, from GitHub Releases (the endpoint and signing key are in
// tauri.conf.json). Checked quietly at startup and by hand on the Settings page. The
// updater verifies each download's signature before installing it, and on Windows the
// installer closes the app, updates it and opens it again.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { devLog, logError } from "$lib/ipc";
import { dialog } from "$lib/stores/dialog.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { toasts } from "$lib/stores/toast.svelte";

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing" | "error";

/** Wait this long after startup before checking, so it doesn't compete with loading the library. */
const STARTUP_DELAY_MS = 8000;

class Updates {
  status = $state<UpdateStatus>("idle");
  /** The newer version, once one is found. */
  available = $state.raw<Update | null>(null);
  /** Download progress from 0 to 1, or null while the size is unknown. */
  progress = $state<number | null>(null);
  error = $state("");

  /** Development builds run from the source folder: installing over them makes no sense. */
  get canInstall() {
    return settings.info ? !settings.info.debug : false;
  }

  /** The quiet check at startup, if it's turned on. Offers the update when there is one. */
  atStartup() {
    if (!settings.app?.checkForUpdates || !this.canInstall) return;
    setTimeout(async () => {
      if (await this.check(true)) this.offer();
    }, STARTUP_DELAY_MS);
  }

  /** Look for a newer version. `quiet` keeps failures out of sight (they're still logged). */
  async check(quiet = false): Promise<boolean> {
    if (this.status === "checking" || this.status === "installing") return false;
    this.status = "checking";
    this.error = "";
    try {
      const update = await check();
      this.available = update;
      this.status = update ? "available" : "current";
      devLog(update ? `update available: ${update.version}` : "no update available");
      return !!update;
    } catch (e) {
      // No internet, GitHub down, or no release published yet.
      this.status = quiet ? "idle" : "error";
      this.error = String(e);
      logError(`update check failed: ${e}`);
      return false;
    }
  }

  /** Ask whether to install the update that was found. */
  offer() {
    const update = this.available;
    if (!update) return;
    dialog.open({
      kind: "confirm",
      title: "Update available",
      message: `Version ${update.version} is ready to install (you have ${update.currentVersion}). The app will close and reopen to finish.`,
      confirm: "Update and restart",
      danger: false,
      onconfirm: () => this.install(),
    });
  }

  /** Download, verify and install the update. On Windows the app closes during this. */
  async install() {
    const update = this.available;
    if (!update || !this.canInstall || this.status === "installing") return;
    this.status = "installing";
    this.progress = null;
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          this.progress = total ? Math.min(1, received / total) : null;
        } else {
          this.progress = 1;
        }
      });
    } catch (e) {
      this.status = "error";
      this.error = String(e);
      logError(`update install failed: ${e}`);
      toasts.error("Couldn't install the update. Try again from Settings.");
    }
  }
}

export const updates = new Updates();
