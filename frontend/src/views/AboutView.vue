<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="page-about">
    <h1>About</h1>
    <p>This is a minimal Vue + Vite + TypeScript starter.</p>
    <p>
      <RouterLink to="/">← back home</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.page-about {
  padding: 2rem;
}
</style>
