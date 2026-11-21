<script lang="ts">
  // Every keyboard shortcut, grouped: in Settings and in the `?` sheet.
  import { LOCAL_KEYS, SHORTCUTS, type ShortcutGroup } from "$lib/shortcuts";

  const GROUPS: ShortcutGroup[] = ["Playback", "Pages and panels", "Moving around"];
  const groups = [
    ...GROUPS.map((g) => ({ title: g, items: SHORTCUTS.filter((s) => s.group === g) })),
    { title: "In lists and popups", items: LOCAL_KEYS },
  ];
</script>

<div class="groups">
  {#each groups as g (g.title)}
    <section>
      <h3 class="eyebrow">{g.title}</h3>
      <dl>
        {#each g.items as s (s.label)}
          <div class="pair">
            <dt>{s.label}</dt>
            <dd>
              {#each s.keys as k, i (i)}{#if i > 0}<span class="plus" aria-hidden="true">+</span>{/if}<kbd>{k}</kbd>{/each}
            </dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}
</div>

<style>
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px 36px;
  }
  h3 {
    margin: 0 0 8px;
  }
  dl {
    margin: 0;
  }
  .pair {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .plus {
    color: var(--faint);
    font-size: 11px;
  }
</style>
