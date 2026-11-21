<script lang="ts">
  // Rounded sound bars growing from the middle: "this is what's playing". Frozen when paused.
  let { playing = true, size = 14 }: { playing?: boolean; size?: number } = $props();
</script>

<span class="eq" class:paused={!playing} style:--size="{size}px" aria-hidden="true">
  <i></i><i></i><i></i><i></i>
</span>

<style>
  .eq {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    width: calc(var(--size) * 1.05);
    height: var(--size);
    flex: none;
    color: var(--accent);
  }
  i {
    width: max(2px, calc(var(--size) * 0.14));
    height: 100%;
    border-radius: 999px;
    background: currentColor;
    animation: eq 0.9s ease-in-out infinite;
  }
  i:nth-child(1) {
    animation-duration: 1s;
    animation-delay: -0.2s;
  }
  i:nth-child(2) {
    animation-duration: 0.75s;
    animation-delay: -0.5s;
  }
  i:nth-child(3) {
    animation-duration: 1.1s;
    animation-delay: -0.1s;
  }
  i:nth-child(4) {
    animation-duration: 0.85s;
    animation-delay: -0.65s;
  }
  .paused i {
    animation-play-state: paused;
  }
</style>
