<template>
  <div class="contents">
    <slot />

    <!-- Rounded-corner overlay: masks each viewport corner with a black wedge -->
    <div class="fixed inset-0 w-full h-screen z-[130] pointer-events-none">
      <div class="absolute top-0 left-0 w-[20px] h-[20px] bg-black clip-inverted-cornerTL"></div>
      <div class="absolute top-0 right-0 w-[20px] h-[20px] bg-black clip-inverted-cornerTR"></div>
      <div class="absolute bottom-0 left-0 w-[20px] h-[20px] bg-black clip-inverted-cornerBL"></div>
      <div class="absolute bottom-0 right-0 w-[20px] h-[20px] bg-black clip-inverted-cornerBR"></div>
    </div>
  </div>
</template>
