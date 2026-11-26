<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="page-404">
    <h1>404</h1>
    <p>The page you were looking for does not exist.</p>
    <p>
      <RouterLink to="/">← back home</RouterLink>
    </p>
  </section>
</template>

<style scoped>
.page-404 {
  padding: 2rem;
  text-align: center;
}
</style>
